import { db } from '@/lib/db';

// Cocktail Engineering Service
// Manages ingredients, recipes, usage logging, and stock deduction with unit conversions.

export type Unit = 'ml' | 'oz' | 'cl' | 'each';

export interface Ingredient {
  id: string;
  name: string;
  unit: Unit; // stock-keeping unit
  stockQty: number; // current quantity in unit
  threshold?: number; // low-stock alert threshold in same unit
  costPerUnit?: number; // cost per unit
}

export interface RecipeIngredient {
  ingredientId: string;
  qty: number; // quantity
  unit: Unit;  // measure unit in recipe
}

export interface CocktailRecipe {
  id: string;
  itemId: string; // POS menu item id
  name: string;
  ingredients: RecipeIngredient[];
  notes?: string;
}

// Unit conversions to ml for liquids
const toMl = (qty: number, unit: Unit): number => {
  if (unit === 'ml') return qty;
  if (unit === 'oz') return qty * 29.5735;
  if (unit === 'cl') return qty * 10;
  return qty; // 'each' treated as 1:1
};
const fromMl = (ml: number, target: Unit): number => {
  if (target === 'ml') return ml;
  if (target === 'oz') return ml / 29.5735;
  if (target === 'cl') return ml / 10;
  return ml; // for 'each', pass-through (not typical)
};

// ============================================================================
// INGREDIENTS
// ============================================================================

export const listIngredients = async (): Promise<Ingredient[]> => {
  try {
    const res = await db.query('SELECT * FROM cocktail_ingredients ORDER BY name');
    if ('rows' in res) {
      return res.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        unit: r.unit as Unit,
        stockQty: Number(r.stock_qty),
        threshold: r.threshold ? Number(r.threshold) : undefined,
        costPerUnit: r.cost_per_unit ? Number(r.cost_per_unit) : undefined
      }));
    }
    return [];
  } catch (e) {
    console.error('Failed to list ingredients:', e);
    return [];
  }
};

export const setIngredients = async (rows: Ingredient[]) => {
  // This was used for bulk save in localStorage. 
  // In DB mode, we generally update individually. 
  // For backward compatibility or bulk import, we could implement a transactional upsert loop.
  // keeping mostly empty or simple implementation as usage pattern usually involves add/update calls.
  console.warn('setIngredients is deprecated in DB mode. Use add/updateIngredient.');
};

export const addIngredient = async (payload: Omit<Ingredient, 'id'> & { id?: string }): Promise<Ingredient | null> => {
  const id = payload.id || `ING_${Date.now()}`;
  try {
    await db.query(
      `INSERT INTO cocktail_ingredients (id, name, unit, stock_qty, threshold, cost_per_unit) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, payload.name, payload.unit, payload.stockQty || 0, payload.threshold || null, payload.costPerUnit || null]
    );
    return {
      id, name: payload.name, unit: payload.unit, stockQty: Number(payload.stockQty || 0), threshold: payload.threshold, costPerUnit: payload.costPerUnit
    };
  } catch (e) {
    console.error('Failed to add ingredient', e);
    return null;
  }
};

export const updateIngredient = async (row: Ingredient) => {
  try {
    await db.query(
      `UPDATE cocktail_ingredients SET name=?, unit=?, stock_qty=?, threshold=?, cost_per_unit=?, updated_at=NOW() WHERE id=?`,
      [row.name, row.unit, row.stockQty, row.threshold || null, row.costPerUnit || null, row.id]
    );
  } catch (e) {
    console.error('Failed to update ingredient', e);
  }
};

export const deleteIngredient = async (id: string) => {
  try {
    await db.query('DELETE FROM cocktail_ingredients WHERE id=?', [id]);
  } catch (e) {
    console.error('Failed to delete ingredient', e);
  }
};

export const getIngredientById = async (id: string): Promise<Ingredient | undefined> => {
  try {
    const res = await db.query('SELECT * FROM cocktail_ingredients WHERE id=?', [id]);
    if ('rows' in res && res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id: r.id,
        name: r.name,
        unit: r.unit as Unit,
        stockQty: Number(r.stock_qty),
        threshold: r.threshold ? Number(r.threshold) : undefined,
        costPerUnit: r.cost_per_unit ? Number(r.cost_per_unit) : undefined
      };
    }
  } catch { }
  return undefined;
};

// ============================================================================
// RECIPES
// ============================================================================

export const listRecipes = async (): Promise<CocktailRecipe[]> => {
  try {
    const res = await db.query('SELECT * FROM cocktail_recipes ORDER BY name');
    if ('rows' in res) {
      return res.rows.map((r: any) => ({
        id: r.id,
        itemId: r.item_id,
        name: r.name,
        ingredients: typeof r.ingredients === 'string' ? JSON.parse(r.ingredients) : r.ingredients,
        notes: r.notes
      }));
    }
    return [];
  } catch { return []; }
};

export const setRecipes = (rows: CocktailRecipe[]) => { console.warn('setRecipes deprecated'); };

export const addRecipe = async (payload: Omit<CocktailRecipe, 'id'> & { id?: string }): Promise<CocktailRecipe | null> => {
  const id = payload.id || `REC_${Date.now()}`;
  try {
    await db.query(
      `INSERT INTO cocktail_recipes (id, item_id, name, ingredients, notes) VALUES (?, ?, ?, ?::jsonb, ?)`,
      [id, payload.itemId, payload.name, JSON.stringify(payload.ingredients || []), payload.notes || null]
    );
    return { id, itemId: payload.itemId, name: payload.name, ingredients: payload.ingredients || [], notes: payload.notes };
  } catch (e) {
    console.error('Failed to add recipe', e);
    return null;
  }
};

export const updateRecipe = async (row: CocktailRecipe) => {
  try {
    await db.query(
      `UPDATE cocktail_recipes SET item_id=?, name=?, ingredients=?::jsonb, notes=?, updated_at=NOW() WHERE id=?`,
      [row.itemId, row.name, JSON.stringify(row.ingredients), row.notes || null, row.id]
    );
  } catch (e) { console.error('Failed update recipe', e); }
};

export const deleteRecipe = async (id: string) => {
  await db.query('DELETE FROM cocktail_recipes WHERE id=?', [id]);
};

export const getRecipeByItemId = async (itemId: string): Promise<CocktailRecipe | undefined> => {
  try {
    const res = await db.query('SELECT * FROM cocktail_recipes WHERE item_id=?', [itemId]);
    if ('rows' in res && res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id: r.id,
        itemId: r.item_id,
        name: r.name,
        ingredients: typeof r.ingredients === 'string' ? JSON.parse(r.ingredients) : r.ingredients,
        notes: r.notes
      };
    }
  } catch { }
  return undefined;
};

// ============================================================================
// COSTING
// ============================================================================

export const computeCostPerCocktail = async (recipe: CocktailRecipe): Promise<number> => {
  const ings = await listIngredients();
  const total = recipe.ingredients.reduce((sum, ri) => {
    const ing = ings.find(i => i.id === ri.ingredientId);
    if (!ing) return sum;
    // Convert recipe qty to ingredient unit if liquid units differ
    let qtyInIngUnit = ri.qty;
    if (ing.unit !== ri.unit && (ing.unit !== 'each' && ri.unit !== 'each')) {
      const ml = toMl(ri.qty, ri.unit);
      qtyInIngUnit = fromMl(ml, ing.unit);
    }
    const cost = Number(ing.costPerUnit || 0) * qtyInIngUnit;
    return sum + cost;
  }, 0);
  return Number(total.toFixed(4));
};

export const calculateRecipeCost = async (recipeId: string): Promise<number> => {
  // This function originally used sync localstorage calls. 
  // We can fetch recipe and delegate to computeCostPerCocktail
  try {
    const res = await db.query('SELECT * FROM cocktail_recipes WHERE id=?', [recipeId]);
    if ('rows' in res && res.rows.length > 0) {
      const r = res.rows[0];
      const recipe = {
        id: r.id,
        itemId: r.item_id,
        name: r.name,
        ingredients: typeof r.ingredients === 'string' ? JSON.parse(r.ingredients) : r.ingredients,
        notes: r.notes
      };
      return await computeCostPerCocktail(recipe);
    }
  } catch { }
  return 0;
};

// ============================================================================
// USAGE & STOCK MANAGEMENT
// ============================================================================

export const recordUsage = async (itemId: string, count: number, recipe: CocktailRecipe) => {
  const id = `USE_${Date.now()}`;
  try {
    await db.query(
      `INSERT INTO cocktail_usage (id, item_id, count, recipe_id, ingredients_snapshot) VALUES (?, ?, ?, ?, ?::jsonb)`,
      [id, itemId, count, recipe.id, JSON.stringify(recipe.ingredients)]
    );
  } catch (e) {
    console.error('Failed to record usage', e);
  }
};

export const listUsageInRange = async (startISO: string, endISO: string): Promise<any[]> => {
  try {
    const res = await db.query(
      `SELECT * FROM cocktail_usage WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`,
      [startISO + 'T00:00:00', endISO + 'T23:59:59']
    );
    if ('rows' in res) {
      return res.rows.map((r: any) => ({
        id: r.id,
        itemId: r.item_id,
        count: r.count,
        recipeId: r.recipe_id,
        ingredients: typeof r.ingredients_snapshot === 'string' ? JSON.parse(r.ingredients_snapshot) : r.ingredients_snapshot,
        ts: r.timestamp
      }));
    }
  } catch { }
  return [];
};

// Waste logging
export interface WasteEntry {
  id: string;
  ingredientId: string;
  qty: number;
  reason: string;
  ts: string;
  bartenderId?: string;
}

export const logWaste = async (ingredientId: string, qty: number, reason: string, bartenderId?: string): Promise<WasteEntry | null> => {
  // Deduct from ingredient stock
  const ingredient = await getIngredientById(ingredientId);
  if (!ingredient) {
    throw new Error('Ingredient not found');
  }

  const newQty = Math.max(0, ingredient.stockQty - qty);
  await updateIngredient({
    ...ingredient,
    stockQty: newQty
  });

  // Log waste entry
  const id = `WASTE_${Date.now()}`;
  const now = new Date().toISOString();

  try {
    await db.query(
      `INSERT INTO cocktail_waste (id, ingredient_id, qty, reason, bartender_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, ingredientId, qty, reason, bartenderId || null, now]
    );

    // We skip audit for now to keep migration simple, or we could add to room_audits if generic
    // Original code wrote to 'corepms_pos_audit' in localstorage.

    return {
      id,
      ingredientId,
      qty,
      reason,
      ts: now,
      bartenderId
    };
  } catch (e) {
    console.error('Failed to log waste', e);
    return null;
  }
};

export const listWasteEntries = async (startISO?: string, endISO?: string): Promise<WasteEntry[]> => {
  let query = 'SELECT * FROM cocktail_waste';
  const params: any[] = [];

  if (startISO && endISO) {
    query += ' WHERE timestamp >= ? AND timestamp <= ?';
    params.push(startISO + 'T00:00:00', endISO + 'T23:59:59');
  }
  query += ' ORDER BY timestamp DESC';

  try {
    const res = await db.query(query, params);
    if ('rows' in res) {
      return res.rows.map((r: any) => ({
        id: r.id,
        ingredientId: r.ingredient_id,
        qty: Number(r.qty),
        reason: r.reason,
        bartenderId: r.bartender_id,
        ts: r.timestamp
      }));
    }
  } catch { }
  return [];
};

export const decrementIngredientsForCocktail = async (itemId: string, count: number): Promise<{ alerts: string[] }> => {
  const recipe = await getRecipeByItemId(itemId);
  if (!recipe) return { alerts: [] };

  const ings = await listIngredients();
  const alerts: string[] = [];

  for (const ing of ings) {
    const ri = recipe.ingredients.find(r => r.ingredientId === ing.id);
    if (!ri) continue;

    // Convert recipe qty to ingredient unit
    let qtyInIngUnit = ri.qty;
    if (ing.unit !== ri.unit && (ing.unit !== 'each' && ri.unit !== 'each')) {
      const ml = toMl(ri.qty, ri.unit);
      qtyInIngUnit = fromMl(ml, ing.unit);
    }
    const used = qtyInIngUnit * count;
    const updatedQty = Math.max(0, Number(ing.stockQty || 0) - used);

    await updateIngredient({ ...ing, stockQty: updatedQty });

    if (typeof ing.threshold === 'number' && updatedQty <= ing.threshold!) {
      alerts.push(`Ingredient '${ing.name}' low: ${updatedQty} ${ing.unit}`);
    }
  }

  await recordUsage(itemId, count, recipe);

  return { alerts };
};

export const restoreIngredientsForCocktail = async (itemId: string, count: number) => {
  const recipe = await getRecipeByItemId(itemId);
  if (!recipe) return;
  const ings = await listIngredients();

  for (const ing of ings) {
    const ri = recipe.ingredients.find(r => r.ingredientId === ing.id);
    if (!ri) continue;

    let qtyInIngUnit = ri.qty;
    if (ing.unit !== ri.unit && (ing.unit !== 'each' && ri.unit !== 'each')) {
      const ml = toMl(ri.qty, ri.unit);
      qtyInIngUnit = fromMl(ml, ing.unit);
    }
    const add = qtyInIngUnit * count;
    await updateIngredient({ ...ing, stockQty: Number(ing.stockQty || 0) + add });
  }
};

// Reorder suggestions
export interface ReorderSuggestion {
  ingredient: Ingredient;
  priority: 'urgent' | 'medium' | 'low';
  suggestedOrderQty: number;
  daysUntilEmpty?: number;
}

export const getReorderSuggestions = async (): Promise<ReorderSuggestion[]> => {
  const ingredients = await listIngredients();
  const suggestions: ReorderSuggestion[] = [];

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const recentUsage = await listUsageInRange(thirtyDaysAgo.toISOString().split('T')[0], now.toISOString().split('T')[0]);

  ingredients.forEach(ingredient => {
    if (ingredient.threshold && ingredient.stockQty <= ingredient.threshold) {
      const ingredientUsage = recentUsage
        .flatMap(entry => entry.ingredients || [])
        .filter((ing: any) => ing.ingredientId === ingredient.id)
        .reduce((sum: number, ing: any) => {
          const mlQty = toMl(ing.qty, ing.unit);
          const baseQty = fromMl(mlQty, ingredient.unit);
          return sum + baseQty;
        }, 0);

      const dailyUsage = ingredientUsage / 30;
      const daysUntilEmpty = dailyUsage > 0 ? ingredient.stockQty / dailyUsage : Infinity;

      let priority: 'urgent' | 'medium' | 'low' = 'low';
      if (ingredient.stockQty === 0 || daysUntilEmpty < 3) {
        priority = 'urgent';
      } else if (daysUntilEmpty < 7) {
        priority = 'medium';
      }

      const suggestedOrderQty = Math.max(
        ingredient.threshold * 2,
        dailyUsage * 14
      );

      suggestions.push({
        ingredient,
        priority,
        suggestedOrderQty: Math.round(suggestedOrderQty),
        daysUntilEmpty: daysUntilEmpty === Infinity ? undefined : Math.round(daysUntilEmpty)
      });
    }
  });

  return suggestions.sort((a, b) => {
    const priorityOrder = { urgent: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    const aDays = a.daysUntilEmpty ?? Infinity;
    const bDays = b.daysUntilEmpty ?? Infinity;
    return aDays - bDays;
  });
};

export default {
  listIngredients,
  setIngredients,
  addIngredient,
  updateIngredient,
  deleteIngredient,
  getIngredientById,
  listRecipes,
  setRecipes,
  addRecipe,
  updateRecipe,
  deleteRecipe,
  getRecipeByItemId,
  computeCostPerCocktail,
  recordUsage,
  listUsageInRange,
  decrementIngredientsForCocktail,
  restoreIngredientsForCocktail,
  logWaste,
  listWasteEntries,
  getReorderSuggestions,
  calculateRecipeCost,
};
