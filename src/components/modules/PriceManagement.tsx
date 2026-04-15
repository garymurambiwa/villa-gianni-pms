import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/posIntegration';
import { db } from '@/lib/db';
import { toast } from 'sonner';
import { Search, Edit, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface ProductItem {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  category: string;
  department: string;
  stock_level: number;
  visibility: any;
  gpPercent?: number;
}

export const PriceManagement: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<ProductItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  // Edit dialog state
  const [editingItem, setEditingItem] = useState<ProductItem | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [newCostPrice, setNewCostPrice] = useState('');
  const [saving, setSaving] = useState(false);

  // Load items from database
  const loadItems = async () => {
    try {
      setLoading(true);
      const result = await db.query(`
        SELECT
          id, name, price, cost_price, category, department,
          stock_level, visibility
        FROM products
        WHERE active = true
        ORDER BY name ASC
      `);

      if ('rows' in result && Array.isArray(result.rows)) {
        const products = result.rows.map((row: any) => ({
          ...row,
          gpPercent: row.cost_price > 0 ? ((row.price - row.cost_price) / row.price) * 100 : 0
        }));
        setItems(products);
        setFilteredItems(products);
      }
    } catch (error) {
      console.error('Failed to load products:', error);
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  // Filter items based on search and filters
  useEffect(() => {
    let filtered = items.filter(item => {
      const matchesSearch = !searchTerm ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.id.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const matchesDepartment = departmentFilter === 'all' || item.department === departmentFilter;

      return matchesSearch && matchesCategory && matchesDepartment;
    });

    setFilteredItems(filtered);
  }, [items, searchTerm, categoryFilter, departmentFilter]);

  // Update price via API for real-time sync across all POS stations
  const updatePrice = async (item: ProductItem, newSellingPrice: number, newCostPrice: number) => {
    try {
      setSaving(true);

      // Use API endpoint for price updates (includes real-time sync)
      const response = await fetch(`/api/v1/prices/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selling_price: newSellingPrice,
          cost_price: newCostPrice,
          updated_by: user?.email || 'Unknown'
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update price');
      }

      // Update local state immediately
      setItems(prev => prev.map(i =>
        i.id === item.id
          ? {
              ...i,
              price: newSellingPrice,
              cost_price: newCostPrice,
              gpPercent: newCostPrice > 0 ? ((newSellingPrice - newCostPrice) / newSellingPrice) * 100 : 0
            }
          : i
      ));

      toast.success(`Price updated for ${item.name} and synced across all POS stations`);

    } catch (error) {
      console.error('Failed to update price:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update price');
    } finally {
      setSaving(false);
      setEditingItem(null);
      setNewPrice('');
      setNewCostPrice('');
    }
  };

  // Open edit dialog
  const openEditDialog = (item: ProductItem) => {
    setEditingItem(item);
    setNewPrice(item.price.toString());
    setNewCostPrice(item.cost_price.toString());
  };

  // Handle save
  const handleSave = () => {
    if (!editingItem) return;

    const sellingPrice = parseFloat(newPrice);
    const costPrice = parseFloat(newCostPrice);

    if (isNaN(sellingPrice) || sellingPrice < 0) {
      toast.error('Invalid selling price');
      return;
    }

    if (isNaN(costPrice) || costPrice < 0) {
      toast.error('Invalid cost price');
      return;
    }

    if (costPrice >= sellingPrice) {
      toast.error('Cost price must be less than selling price');
      return;
    }

    updatePrice(editingItem, sellingPrice, costPrice);
  };

  useEffect(() => {
    loadItems();
  }, []);

  // Listen for price update events from other tabs
  useEffect(() => {
    const handlePriceUpdate = () => {
      // Reload data when price updates are detected
      loadItems();
    };

    window.addEventListener('priceUpdate', handlePriceUpdate);
    return () => window.removeEventListener('priceUpdate', handlePriceUpdate);
  }, []);

  const uniqueCategories = [...new Set(items.map(item => item.category).filter(Boolean))];
  const uniqueDepartments = [...new Set(items.map(item => item.department).filter(Boolean))];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Price Management</h1>
          <p className="text-gray-600 mt-1">Update selling prices that will sync across all POS stations</p>
        </div>
        <Button onClick={loadItems} variant="outline">
          <Search className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-64">
              <Label htmlFor="search">Search Products</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="search"
                  placeholder="Search by name or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="w-48">
              <Label>Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {uniqueCategories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Label>Department</Label>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {uniqueDepartments.map(dept => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>Products ({filteredItems.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Selling Price</TableHead>
                  <TableHead>Cost Price</TableHead>
                  <TableHead>Gross Profit</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{item.department}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatCurrency(item.price)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatCurrency(item.cost_price)}
                    </TableCell>
                    <TableCell>
                      <span className={`font-medium ${
                        (item.gpPercent || 0) < 20 ? 'text-red-600' :
                        (item.gpPercent || 0) < 40 ? 'text-yellow-600' : 'text-green-600'
                      }`}>
                        {(item.gpPercent || 0).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>{item.stock_level}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(item)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit Price
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Price Dialog */}
      <Dialog open={!!editingItem} onOpenChange={() => setEditingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Price: {editingItem?.name}</DialogTitle>
            <DialogDescription>
              Changes will be saved to the database and synced across all POS stations immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="selling-price">Selling Price (€)</Label>
                <Input
                  id="selling-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label htmlFor="cost-price">Cost Price (€)</Label>
                <Input
                  id="cost-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={newCostPrice}
                  onChange={(e) => setNewCostPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            {newPrice && newCostPrice && !isNaN(parseFloat(newPrice)) && !isNaN(parseFloat(newCostPrice)) && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-600">
                  <div>New Gross Profit: {(((parseFloat(newPrice) - parseFloat(newCostPrice)) / parseFloat(newPrice)) * 100).toFixed(1)}%</div>
                  <div className="text-xs mt-1">
                    {parseFloat(newCostPrice) >= parseFloat(newPrice) && (
                      <span className="text-red-600 flex items-center">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Cost price should be less than selling price
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};