/**
 * Price Management API Routes
 * Handles price updates with real-time sync across POS stations
 */

const express = require('express');
const { Pool } = require('pg');
const path = require('path');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const router = express.Router();
require('express-ws')(router);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// WebSocket connections for real-time updates
// Note: WebSocket routes are handled at the app level in server/index.cjs
const connectedClients = new Set();

// Function to add WebSocket client (called from main server)
function addWebSocketClient(ws) {
  connectedClients.add(ws);
  console.log(`[PriceSync] Client connected. Total clients: ${connectedClients.size}`);

  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`[PriceSync] Client disconnected. Total clients: ${connectedClients.size}`);
  });

  ws.on('error', (error) => {
    console.error('[PriceSync] WebSocket error:', error);
    connectedClients.delete(ws);
  });
}

// Broadcast price update to all connected clients
function broadcastPriceUpdate(updateData) {
  const message = JSON.stringify({
    type: 'PRICE_UPDATE',
    data: updateData,
    timestamp: new Date().toISOString()
  });

  let sentCount = 0;
  connectedClients.forEach(ws => {
    try {
      if (ws.readyState === 1) { // OPEN
        ws.send(message);
        sentCount++;
      }
    } catch (error) {
      console.error('[PriceSync] Failed to send to client:', error);
      connectedClients.delete(ws);
    }
  });

  console.log(`[PriceSync] Broadcasted price update to ${sentCount} clients`);
}

/**
 * GET /api/v1/prices
 * Get all product prices
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id, name, price as selling_price, cost_price,
        category, department, stock_level, visibility
      FROM products
      WHERE active = true
      ORDER BY name ASC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Failed to fetch prices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch prices'
    });
  }
});

/**
 * PUT /api/v1/prices/:id
 * Update price for a specific product
 */
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  const { id } = req.params;
  const { selling_price, cost_price, updated_by } = req.body;

  if (!selling_price || !cost_price) {
    return res.status(400).json({
      success: false,
      error: 'Selling price and cost price are required'
    });
  }

  if (cost_price >= selling_price) {
    return res.status(400).json({
      success: false,
      error: 'Cost price must be less than selling price'
    });
  }

  try {
    await client.query('BEGIN');

    // Get current price for audit
    const currentResult = await client.query(
      'SELECT price, cost_price, name FROM products WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    const currentProduct = currentResult.rows[0];

    // Update product price
    await client.query(`
      UPDATE products
      SET price = $1, cost_price = $2, updated_at = NOW()
      WHERE id = $3
    `, [selling_price, cost_price, id]);

    // Update inventory_items as well for POS consistency
    await client.query(`
      UPDATE inventory_items
      SET price = $1, cost = $2, updated_at = NOW()
      WHERE id = $3
    `, [selling_price, cost_price, id]).catch(() => {
      // Ignore if inventory_items update fails
    });

    // Log the price change
    await client.query(`
      INSERT INTO audit_log (action, details, user_id, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [
      'PRICE_UPDATE',
      JSON.stringify({
        itemId: id,
        itemName: currentProduct.name,
        oldPrice: currentProduct.price,
        newPrice: selling_price,
        oldCostPrice: currentProduct.cost_price,
        newCostPrice: cost_price,
        updatedBy: updated_by || 'Unknown'
      }),
      null // user_id - would need authentication middleware
    ]).catch(() => {
      // Ignore audit log failures
    });

    await client.query('COMMIT');

    // Broadcast update to all connected POS stations
    const updateData = {
      itemId: id,
      itemName: currentProduct.name,
      oldPrice: currentProduct.price,
      newPrice: selling_price,
      oldCostPrice: currentProduct.cost_price,
      newCostPrice: cost_price,
      updatedBy: updated_by || 'Unknown',
      timestamp: new Date().toISOString()
    };

    broadcastPriceUpdate(updateData);

    res.json({
      success: true,
      data: updateData
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update price'
    });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/prices/sync
 * Force sync prices across all stations (clears caches)
 */
router.post('/sync', async (req, res) => {
  try {
    // Broadcast cache invalidation
    const message = JSON.stringify({
      type: 'CACHE_INVALIDATE',
      data: { reason: 'Manual sync requested' },
      timestamp: new Date().toISOString()
    });

    let sentCount = 0;
    connectedClients.forEach(ws => {
      try {
        if (ws.readyState === 1) {
          ws.send(message);
          sentCount++;
        }
      } catch (error) {
        connectedClients.delete(ws);
      }
    });

    res.json({
      success: true,
      message: `Sync broadcasted to ${sentCount} connected clients`
    });
  } catch (error) {
    console.error('Failed to broadcast sync:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to broadcast sync'
    });
  }
});

// WebSocket endpoint for real-time price synchronization
// This is the endpoint the browser connects to via initializePriceSync()
router.ws('/sync', (ws, req) => {
  console.log('[PriceSync] WebSocket client connected to /sync');
  addWebSocketClient(ws);
});

module.exports = router;
module.exports.addWebSocketClient = addWebSocketClient;