import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/posIntegration';
import { 
  listIngredients, 
  addIngredient, 
  updateIngredient, 
  deleteIngredient,
  listRecipes,
  addRecipe,
  updateRecipe,
  deleteRecipe,
  logWaste,
  getReorderSuggestions,
  calculateRecipeCost,
  type Ingredient,
  type Recipe,
  type RecipeIngredient,
  type WasteEntry
} from '@/lib/cocktailEngineering';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border rounded-lg p-4 mb-6 bg-white">
    <h4 className="text-sm font-semibold mb-3">{title}</h4>
    <div className="space-y-4 text-sm">{children}</div>
  </div>
);

const IngredientsPanel: React.FC = () => {
  const { toast } = useToast();
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([]);
  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  
  // Form state
  const [name, setName] = React.useState('');
  const [unit, setUnit] = React.useState<'ml' | 'oz' | 'cl' | 'each'>('ml');
  const [stockQty, setStockQty] = React.useState<number>(0);
  const [threshold, setThreshold] = React.useState<number>(0);
  const [costPerUnit, setCostPerUnit] = React.useState<number>(0);

  React.useEffect(() => {
    setIngredients(listIngredients());
  }, []);

  const resetForm = () => {
    setName('');
    setUnit('ml');
    setStockQty(0);
    setThreshold(0);
    setCostPerUnit(0);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: 'Name required', description: 'Enter ingredient name' });
      return;
    }

    const ingredientData = {
      name: name.trim(),
      unit,
      stockQty,
      threshold,
      costPerUnit
    };

    try {
      if (editingId) {
        updateIngredient(editingId, ingredientData);
        toast({ title: 'Ingredient updated', description: `${name} has been updated` });
      } else {
        addIngredient(ingredientData);
        toast({ title: 'Ingredient added', description: `${name} has been added to inventory` });
      }
      
      setIngredients(listIngredients());
      setShowAddDialog(false);
      resetForm();
    } catch (error) {
      toast({ title: 'Error', description: String(error) });
    }
  };

  const handleEdit = (ingredient: Ingredient) => {
    setName(ingredient.name);
    setUnit(ingredient.unit);
    setStockQty(ingredient.stockQty);
    setThreshold(ingredient.threshold);
    setCostPerUnit(ingredient.costPerUnit);
    setEditingId(ingredient.id);
    setShowAddDialog(true);
  };

  const handleDelete = (id: string) => {
    try {
      deleteIngredient(id);
      setIngredients(listIngredients());
      toast({ title: 'Ingredient deleted', description: 'Ingredient removed from inventory' });
    } catch (error) {
      toast({ title: 'Error', description: String(error) });
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h5 className="font-medium">Ingredient Inventory</h5>
        <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
          Add Ingredient
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Stock</th>
              <th className="text-left p-2">Unit</th>
              <th className="text-left p-2">Threshold</th>
              <th className="text-left p-2">Cost/Unit</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map(ingredient => (
              <tr key={ingredient.id} className="border-b">
                <td className="p-2 font-medium">{ingredient.name}</td>
                <td className="p-2">{ingredient.stockQty}</td>
                <td className="p-2">{ingredient.unit}</td>
                <td className="p-2">{ingredient.threshold}</td>
                <td className="p-2">{formatCurrency(ingredient.costPerUnit)}</td>
                <td className="p-2">
                  {ingredient.stockQty <= ingredient.threshold ? (
                    <Badge variant="destructive">Low Stock</Badge>
                  ) : (
                    <Badge variant="secondary">In Stock</Badge>
                  )}
                </td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(ingredient)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(ingredient.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Ingredient' : 'Add New Ingredient'}</DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-medium">Name</label>
              <Input 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Vodka, Simple Syrup, Lime Juice"
              />
            </div>
            
            <div>
              <label className="text-xs font-medium">Unit</label>
              <Select value={unit} onValueChange={(v: any) => setUnit(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ml">Milliliters (ml)</SelectItem>
                  <SelectItem value="oz">Ounces (oz)</SelectItem>
                  <SelectItem value="cl">Centiliters (cl)</SelectItem>
                  <SelectItem value="each">Each (whole items)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-xs font-medium">Current Stock</label>
              <Input 
                type="number" 
                value={stockQty} 
                onChange={(e) => setStockQty(Number(e.target.value))}
                placeholder="0"
              />
            </div>
            
            <div>
              <label className="text-xs font-medium">Low Stock Threshold</label>
              <Input 
                type="number" 
                value={threshold} 
                onChange={(e) => setThreshold(Number(e.target.value))}
                placeholder="0"
              />
            </div>
            
            <div>
              <label className="text-xs font-medium">Cost per Unit</label>
              <Input 
                type="number" 
                step="0.01"
                value={costPerUnit} 
                onChange={(e) => setCostPerUnit(Number(e.target.value))}
                placeholder="0.00"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Add'} Ingredient</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const RecipesPanel: React.FC = () => {
  const { toast } = useToast();
  const [recipes, setRecipes] = React.useState<Recipe[]>([]);
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([]);
  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  
  // Form state
  const [itemId, setItemId] = React.useState('');
  const [name, setName] = React.useState('');
  const [recipeIngredients, setRecipeIngredients] = React.useState<RecipeIngredient[]>([]);

  React.useEffect(() => {
    setRecipes(listRecipes());
    setIngredients(listIngredients());
  }, []);

  const resetForm = () => {
    setItemId('');
    setName('');
    setRecipeIngredients([]);
    setEditingId(null);
  };

  const addRecipeIngredient = () => {
    setRecipeIngredients([...recipeIngredients, { ingredientId: '', qty: 0, unit: 'ml' }]);
  };

  const updateRecipeIngredient = (index: number, field: keyof RecipeIngredient, value: any) => {
    const updated = [...recipeIngredients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipeIngredients(updated);
  };

  const removeRecipeIngredient = (index: number) => {
    setRecipeIngredients(recipeIngredients.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: 'Name required', description: 'Enter recipe name' });
      return;
    }

    if (!itemId.trim()) {
      toast({ title: 'Item ID required', description: 'Enter POS item ID' });
      return;
    }

    if (recipeIngredients.length === 0) {
      toast({ title: 'Ingredients required', description: 'Add at least one ingredient' });
      return;
    }

    const recipeData = {
      itemId: itemId.trim(),
      name: name.trim(),
      ingredients: recipeIngredients.filter(ri => ri.ingredientId && ri.qty > 0)
    };

    try {
      if (editingId) {
        updateRecipe(editingId, recipeData);
        toast({ title: 'Recipe updated', description: `${name} has been updated` });
      } else {
        addRecipe(recipeData);
        toast({ title: 'Recipe added', description: `${name} has been added` });
      }
      
      setRecipes(listRecipes());
      setShowAddDialog(false);
      resetForm();
    } catch (error) {
      toast({ title: 'Error', description: String(error) });
    }
  };

  const handleEdit = (recipe: Recipe) => {
    setItemId(recipe.itemId);
    setName(recipe.name);
    setRecipeIngredients([...recipe.ingredients]);
    setEditingId(recipe.id);
    setShowAddDialog(true);
  };

  const handleDelete = (id: string) => {
    try {
      deleteRecipe(id);
      setRecipes(listRecipes());
      toast({ title: 'Recipe deleted', description: 'Recipe removed' });
    } catch (error) {
      toast({ title: 'Error', description: String(error) });
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h5 className="font-medium">Cocktail Recipes</h5>
        <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
          Add Recipe
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Item ID</th>
              <th className="text-left p-2">Ingredients</th>
              <th className="text-left p-2">Cost</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {recipes.map(recipe => (
              <tr key={recipe.id} className="border-b">
                <td className="p-2 font-medium">{recipe.name}</td>
                <td className="p-2">{recipe.itemId}</td>
                <td className="p-2">{recipe.ingredients.length} ingredients</td>
                <td className="p-2">{formatCurrency(calculateRecipeCost(recipe.id))}</td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(recipe)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(recipe.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Recipe' : 'Add New Recipe'}</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium">Recipe Name</label>
                <Input 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Mojito, Old Fashioned"
                />
              </div>
              
              <div>
                <label className="text-xs font-medium">POS Item ID</label>
                <Input 
                  value={itemId} 
                  onChange={(e) => setItemId(e.target.value)}
                  placeholder="e.g., MOJITO_001"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium">Recipe Ingredients</label>
                <Button size="sm" onClick={addRecipeIngredient}>Add Ingredient</Button>
              </div>
              
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {recipeIngredients.map((ri, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5">
                      <Select 
                        value={ri.ingredientId} 
                        onValueChange={(v) => updateRecipeIngredient(index, 'ingredientId', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select ingredient" />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredients.map(ing => (
                            <SelectItem key={ing.id} value={ing.id}>
                              {ing.name} ({ing.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="col-span-3">
                      <Input 
                        type="number" 
                        step="0.1"
                        value={ri.qty} 
                        onChange={(e) => updateRecipeIngredient(index, 'qty', Number(e.target.value))}
                        placeholder="Qty"
                      />
                    </div>
                    
                    <div className="col-span-3">
                      <Select 
                        value={ri.unit} 
                        onValueChange={(v: any) => updateRecipeIngredient(index, 'unit', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ml">ml</SelectItem>
                          <SelectItem value="oz">oz</SelectItem>
                          <SelectItem value="cl">cl</SelectItem>
                          <SelectItem value="each">each</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="col-span-1">
                      <Button 
                        size="sm" 
                        variant="destructive" 
                        onClick={() => removeRecipeIngredient(index)}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Add'} Recipe</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const WasteLoggingPanel: React.FC = () => {
  const { toast } = useToast();
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([]);
  const [selectedIngredient, setSelectedIngredient] = React.useState('');
  const [wasteQty, setWasteQty] = React.useState<number>(0);
  const [wasteReason, setWasteReason] = React.useState('');

  React.useEffect(() => {
    setIngredients(listIngredients());
  }, []);

  const handleLogWaste = () => {
    if (!selectedIngredient) {
      toast({ title: 'Ingredient required', description: 'Select an ingredient' });
      return;
    }

    if (wasteQty <= 0) {
      toast({ title: 'Quantity required', description: 'Enter waste quantity' });
      return;
    }

    if (!wasteReason.trim()) {
      toast({ title: 'Reason required', description: 'Enter waste reason' });
      return;
    }

    try {
      logWaste(selectedIngredient, wasteQty, wasteReason.trim());
      toast({ 
        title: 'Waste logged', 
        description: `${wasteQty} units of waste recorded` 
      });
      
      // Reset form
      setSelectedIngredient('');
      setWasteQty(0);
      setWasteReason('');
      
      // Refresh ingredients to show updated stock
      setIngredients(listIngredients());
    } catch (error) {
      toast({ title: 'Error', description: String(error) });
    }
  };

  return (
    <div className="space-y-4">
      <h5 className="font-medium">Log Bartender Waste</h5>
      <p className="text-xs text-gray-600">
        Record spills, overpours, and other waste to maintain accurate inventory levels.
      </p>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium">Ingredient</label>
          <Select value={selectedIngredient} onValueChange={setSelectedIngredient}>
            <SelectTrigger>
              <SelectValue placeholder="Select ingredient" />
            </SelectTrigger>
            <SelectContent>
              {ingredients.map(ing => (
                <SelectItem key={ing.id} value={ing.id}>
                  {ing.name} (Stock: {ing.stockQty} {ing.unit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <label className="text-xs font-medium">Waste Quantity</label>
          <Input 
            type="number" 
            step="0.1"
            value={wasteQty} 
            onChange={(e) => setWasteQty(Number(e.target.value))}
            placeholder="0"
          />
        </div>
      </div>
      
      <div>
        <label className="text-xs font-medium">Reason</label>
        <Select value={wasteReason} onValueChange={setWasteReason}>
          <SelectTrigger>
            <SelectValue placeholder="Select reason" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spill">Spill</SelectItem>
            <SelectItem value="overpour">Overpour</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="contaminated">Contaminated</SelectItem>
            <SelectItem value="training">Training/Practice</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <Button onClick={handleLogWaste} className="w-full">
        Log Waste
      </Button>
    </div>
  );
};

const ReorderSuggestionsPanel: React.FC = () => {
  const [suggestions, setSuggestions] = React.useState<any[]>([]);

  React.useEffect(() => {
    setSuggestions(getReorderSuggestions());
  }, []);

  return (
    <div className="space-y-4">
      <h5 className="font-medium">Reorder Suggestions</h5>
      
      {suggestions.length === 0 ? (
        <p className="text-sm text-gray-600">All ingredients are well-stocked!</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Ingredient</th>
                <th className="text-left p-2">Current Stock</th>
                <th className="text-left p-2">Threshold</th>
                <th className="text-left p-2">Suggested Order</th>
                <th className="text-left p-2">Priority</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map(suggestion => (
                <tr key={suggestion.ingredient.id} className="border-b">
                  <td className="p-2 font-medium">{suggestion.ingredient.name}</td>
                  <td className="p-2">{suggestion.ingredient.stockQty} {suggestion.ingredient.unit}</td>
                  <td className="p-2">{suggestion.ingredient.threshold} {suggestion.ingredient.unit}</td>
                  <td className="p-2">{suggestion.suggestedOrderQty} {suggestion.ingredient.unit}</td>
                  <td className="p-2">
                    <Badge variant={suggestion.priority === 'urgent' ? 'destructive' : 'secondary'}>
                      {suggestion.priority}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const CocktailEngineering: React.FC = () => {
  return (
    <div className="space-y-6">
      <Section title="Ingredient Management">
        <IngredientsPanel />
      </Section>

      <Section title="Recipe Builder">
        <RecipesPanel />
      </Section>

      <Section title="Waste Logging">
        <WasteLoggingPanel />
      </Section>

      <Section title="Reorder Suggestions">
        <ReorderSuggestionsPanel />
      </Section>
    </div>
  );
};

export default CocktailEngineering;