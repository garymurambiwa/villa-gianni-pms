import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Edit, Trash2, Package, Coffee, Users } from 'lucide-react';
import { breakfastPackageService } from '@/lib/breakfastPackageService';
import { BreakfastPackage, BreakfastPackageSeasonalRate } from '@/types/breakfastPackages';
import { toast } from 'sonner';

interface SeasonalRate {
  id: string;
  packageName: string;
  season: string;
  multiplier: number;
}

export const BreakfastManager: React.FC = () => {
  const [packages, setPackages] = React.useState<BreakfastPackage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  
  const [seasonalRates, setSeasonalRates] = React.useState<SeasonalRate[]>([
    {
      id: 'sr-1',
      packageName: 'Bed & Breakfast',
      season: 'Peak Season',
      multiplier: 1.2
    },
    {
      id: 'sr-2',
      packageName: 'Half Board',
      season: 'Low Season',
      multiplier: 0.9
    }
  ]);

  const [newPackage, setNewPackage] = React.useState<Omit<BreakfastPackage, 'id' | 'isActive' | 'sortOrder'>>({
    code: '',
    name: '',
    description: '',
    basePrice: 0,
    adultPrice: 0,
    childPrice: 0,
    applicableRoomTypes: []
  });

  const [editingPackage, setEditingPackage] = React.useState<BreakfastPackage | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);

  const [newSeasonalRate, setNewSeasonalRate] = React.useState<Omit<SeasonalRate, 'id'>>({
    packageName: '',
    season: '',
    multiplier: 1.0
  });

  // Load packages on component mount
  React.useEffect(() => {
    loadPackages();
  }, []);

  const loadPackages = async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedPackages = await breakfastPackageService.getAllPackages();
      setPackages(fetchedPackages);
    } catch (err) {
      console.error('Failed to load packages:', err);
      setError('Failed to load breakfast packages');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPackage = async () => {
    if (!newPackage.code || !newPackage.name) {
      toast.error('Package code and name are required');
      return;
    }
    
    try {
      setError(null);
      console.log('[BreakfastManager] Creating package:', newPackage);
      
      const packageToAdd = await breakfastPackageService.createPackage({
        ...newPackage,
        isActive: true,
        sortOrder: packages.length + 1,
        applicableRoomTypes: newPackage.applicableRoomTypes || []
      });
      
      console.log('[BreakfastManager] Package created:', packageToAdd);
      
      setPackages([...packages, packageToAdd]);
      setNewPackage({
        code: '',
        name: '',
        description: '',
        basePrice: 0,
        adultPrice: 0,
        childPrice: 0,
        applicableRoomTypes: []
      });
      
      toast.success('Breakfast package created successfully');
    } catch (error: any) {
      const errorMsg = error?.message || 'Unknown error occurred';
      console.error('[BreakfastManager] Failed to create package:', errorMsg);
      setError(`Failed to create breakfast package: ${errorMsg}`);
      toast.error(`Failed to create package: ${errorMsg}`);
    }
  };

  const handleEditPackage = (pkg: BreakfastPackage) => {
    setEditingPackage(pkg);
    setIsEditDialogOpen(true);
  };

  const handleUpdatePackage = async () => {
    if (!editingPackage) return;
    
    try {
      console.log('[BreakfastManager] Updating package:', editingPackage.id);
      
      const updatedPackage = await breakfastPackageService.updatePackage(editingPackage.id, {
        code: editingPackage.code,
        name: editingPackage.name,
        description: editingPackage.description,
        basePrice: editingPackage.basePrice,
        adultPrice: editingPackage.adultPrice,
        childPrice: editingPackage.childPrice,
        isActive: editingPackage.isActive,
        sortOrder: editingPackage.sortOrder,
        applicableRoomTypes: editingPackage.applicableRoomTypes || []
      });
      
      console.log('[BreakfastManager] Package updated:', updatedPackage);
      
      setPackages(packages.map(pkg => pkg.id === updatedPackage.id ? updatedPackage : pkg));
      setIsEditDialogOpen(false);
      setEditingPackage(null);
      toast.success('Breakfast package updated successfully');
    } catch (error: any) {
      const errorMsg = error?.message || 'Unknown error occurred';
      console.error('[BreakfastManager] Failed to update package:', errorMsg);
      toast.error(`Failed to update package: ${errorMsg}`);
    }
  };

  const handleDeletePackage = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this breakfast package?')) return;
    
    try {
      console.log('[BreakfastManager] Deleting package:', id);
      
      const success = await breakfastPackageService.deletePackage(id);
      if (success) {
        setPackages(packages.filter(pkg => pkg.id !== id));
        toast.success('Breakfast package deleted successfully');
      } else {
        toast.error('Failed to delete package');
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Unknown error occurred';
      console.error('[BreakfastManager] Failed to delete package:', errorMsg);
      toast.error(`Failed to delete package: ${errorMsg}`);
    }
  };

  const handleAddSeasonalRate = () => {
    if (!newSeasonalRate.packageName || !newSeasonalRate.season) return;
    
    const rateToAdd: SeasonalRate = {
      ...newSeasonalRate,
      id: `sr-${Date.now()}`
    };
    
    setSeasonalRates([...seasonalRates, rateToAdd]);
    setNewSeasonalRate({
      packageName: '',
      season: '',
      multiplier: 1.0
    });
  };

  const handleDeleteSeasonalRate = (id: string) => {
    setSeasonalRates(seasonalRates.filter(rate => rate.id !== id));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Breakfast Management</h1>
          <p className="text-gray-600 mt-2">Manage breakfast packages and seasonal pricing</p>
        </div>
        <div className="flex items-center space-x-2">
          <Coffee className="h-8 w-8 text-amber-600" />
          <Package className="h-8 w-8 text-blue-600" />
        </div>
      </div>

      <Tabs defaultValue="packages" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="packages" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Packages
          </TabsTrigger>
          <TabsTrigger value="seasonal" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Seasonal Rates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="packages" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Add New Breakfast Package</CardTitle>
              <CardDescription>Create a new breakfast package option for guests</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Package Code</Label>
                  <Input
                    id="code"
                    value={newPackage.code}
                    onChange={(e) => setNewPackage({...newPackage, code: e.target.value})}
                    placeholder="e.g., BB, HB, FB"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Package Name</Label>
                  <Input
                    id="name"
                    value={newPackage.name}
                    onChange={(e) => setNewPackage({...newPackage, name: e.target.value})}
                    placeholder="e.g., Bed & Breakfast"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={newPackage.description}
                    onChange={(e) => setNewPackage({...newPackage, description: e.target.value})}
                    placeholder="Brief description of the package"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="basePrice">Base Price ($)</Label>
                  <Input
                    id="basePrice"
                    type="number"
                    value={newPackage.basePrice}
                    onChange={(e) => setNewPackage({...newPackage, basePrice: parseFloat(e.target.value) || 0})}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adultPrice">Adult Price ($)</Label>
                  <Input
                    id="adultPrice"
                    type="number"
                    value={newPackage.adultPrice}
                    onChange={(e) => setNewPackage({...newPackage, adultPrice: parseFloat(e.target.value) || 0})}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="childPrice">Child Price ($)</Label>
                  <Input
                    id="childPrice"
                    type="number"
                    value={newPackage.childPrice}
                    onChange={(e) => setNewPackage({...newPackage, childPrice: parseFloat(e.target.value) || 0})}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <Button onClick={handleAddPackage} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Package
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Existing Packages</CardTitle>
              <CardDescription>Manage your current breakfast package offerings</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-2 text-gray-600">Loading packages...</p>
                </div>
              ) : error ? (
                <div className="text-center py-8 text-red-600">
                  <p>Error: {error}</p>
                  <Button onClick={loadPackages} className="mt-2">Retry</Button>
                </div>
              ) : packages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No breakfast packages found</p>
                  <p className="text-sm mt-1">Create your first package using the form above</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Base Price</TableHead>
                      <TableHead>Adult Price</TableHead>
                      <TableHead>Child Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packages.map((pkg) => (
                      <TableRow key={pkg.id}>
                        <TableCell className="font-medium">{pkg.code}</TableCell>
                        <TableCell>{pkg.name}</TableCell>
                        <TableCell>{pkg.description || '-'}</TableCell>
                        <TableCell>${pkg.basePrice.toFixed(2)}</TableCell>
                        <TableCell>${pkg.adultPrice.toFixed(2)}</TableCell>
                        <TableCell>${pkg.childPrice.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={pkg.isActive ? "default" : "secondary"}>
                            {pkg.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleEditPackage(pkg)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleDeletePackage(pkg.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seasonal" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Add Seasonal Rate</CardTitle>
              <CardDescription>Configure seasonal pricing multipliers for packages</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="packageName">Package</Label>
                  <select
                    id="packageName"
                    value={newSeasonalRate.packageName}
                    onChange={(e) => setNewSeasonalRate({...newSeasonalRate, packageName: e.target.value})}
                    className="w-full p-2 border rounded-md"
                  >
                    <option value="">Select Package</option>
                    {packages.map(pkg => (
                      <option key={pkg.id} value={pkg.name}>{pkg.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="season">Season</Label>
                  <Input
                    id="season"
                    value={newSeasonalRate.season}
                    onChange={(e) => setNewSeasonalRate({...newSeasonalRate, season: e.target.value})}
                    placeholder="e.g., Peak Season"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="multiplier">Multiplier</Label>
                  <Input
                    id="multiplier"
                    type="number"
                    step="0.01"
                    value={newSeasonalRate.multiplier}
                    onChange={(e) => setNewSeasonalRate({...newSeasonalRate, multiplier: parseFloat(e.target.value) || 1.0})}
                    placeholder="1.00"
                  />
                </div>
              </div>
              <Button onClick={handleAddSeasonalRate} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Seasonal Rate
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Seasonal Pricing</CardTitle>
              <CardDescription>Current seasonal rate configurations</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Package</TableHead>
                    <TableHead>Season</TableHead>
                    <TableHead>Multiplier</TableHead>
                    <TableHead>Effective Rate</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {seasonalRates.map((rate) => {
                    const basePackage = packages.find(pkg => pkg.name === rate.packageName);
                    const effectiveBase = basePackage ? basePackage.basePrice * rate.multiplier : 0;
                    const effectiveAdult = basePackage ? basePackage.adultPrice * rate.multiplier : 0;
                    const effectiveChild = basePackage ? basePackage.childPrice * rate.multiplier : 0;
                    
                    return (
                      <TableRow key={rate.id}>
                        <TableCell className="font-medium">{rate.packageName}</TableCell>
                        <TableCell>{rate.season}</TableCell>
                        <TableCell>{rate.multiplier.toFixed(2)}x</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>Base: ${effectiveBase.toFixed(2)}</div>
                            <div>Adult: ${effectiveAdult.toFixed(2)}</div>
                            <div>Child: ${effectiveChild.toFixed(2)}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="outline" size="sm">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleDeleteSeasonalRate(rate.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Package Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Breakfast Package</DialogTitle>
          </DialogHeader>
          
          {editingPackage && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-code">Package Code *</Label>
                  <Input
                    id="edit-code"
                    value={editingPackage.code}
                    onChange={(e) => setEditingPackage({...editingPackage, code: e.target.value})}
                    placeholder="e.g., BB, HB, FB"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Package Name *</Label>
                  <Input
                    id="edit-name"
                    value={editingPackage.name}
                    onChange={(e) => setEditingPackage({...editingPackage, name: e.target.value})}
                    placeholder="e.g., Bed & Breakfast"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="edit-description">Description</Label>
                  <Input
                    id="edit-description"
                    value={editingPackage.description || ''}
                    onChange={(e) => setEditingPackage({...editingPackage, description: e.target.value})}
                    placeholder="Brief description of the package"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-basePrice">Base Price ($)</Label>
                  <Input
                    id="edit-basePrice"
                    type="number"
                    value={editingPackage.basePrice}
                    onChange={(e) => setEditingPackage({...editingPackage, basePrice: parseFloat(e.target.value) || 0})}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-adultPrice">Adult Price ($)</Label>
                  <Input
                    id="edit-adultPrice"
                    type="number"
                    value={editingPackage.adultPrice}
                    onChange={(e) => setEditingPackage({...editingPackage, adultPrice: parseFloat(e.target.value) || 0})}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-childPrice">Child Price ($)</Label>
                  <Input
                    id="edit-childPrice"
                    type="number"
                    value={editingPackage.childPrice}
                    onChange={(e) => setEditingPackage({...editingPackage, childPrice: parseFloat(e.target.value) || 0})}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2 flex items-end">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="edit-isActive"
                      checked={editingPackage.isActive}
                      onChange={(e) => setEditingPackage({...editingPackage, isActive: e.target.checked})}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="edit-isActive">Active Package</Label>
                  </div>
                </div>
              </div>
              
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdatePackage}>
                  Save Changes
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BreakfastManager;