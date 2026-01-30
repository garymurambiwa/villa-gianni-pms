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

const K_ING = 'corepms_cocktail_ingredients';
const K_REC = 'corepms_cocktail_recipes';
const K_USE = 'corepms_cocktail_usage';

const readJSON = <T>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

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

export const listIngredients = (): Ingredient[] => readJSON<Ingredient[]>(K_ING, []);
export const setIngredients = (rows: Ingredient[]) => writeJSON(K_ING, rows);
export const addIngredient = (payload: Omit<Ingredient, 'id'> & { id?: string }): Ingredient => {
  const id = payload.id || `ING_${Date.now()}`;
  const row: Ingredient = { id, name: payload.name, unit: payload.unit, stockQty: Number(payload.stockQty || 0), threshold: payload.threshold, costPerUnit: payload.costPerUnit };
  const list = listIngredients();
  const exist = list.findIndex(i => i.id === id);
  const next = exist >= 0 ? list.map(i => i.id === id ? row : i) : [row, ...list];
  setIngredients(next);
  return row;
};
export const updateIngredient = (row: Ingredient) => setIngredients(listIngredients().map(i => i.id === row.id ? { ...i, ...row } : i));
export const deleteIngredient = (id: string) => setIngredients(listIngredients().filter(i => i.id !== id));
export const getIngredientById = (id: string) => listIngredients().find(i => i.id === id);

export const listRecipes = (): CocktailRecipe[] => readJSON<CocktailRecipe[]>(K_REC, []);
export const setRecipes = (rows: CocktailRecipe[]) => writeJSON(K_REC, rows);
export const addRecipe = (payload: Omit<CocktailRecipe, 'id'> & { id?: string }): CocktailRecipe => {
  const id = payload.id || `REC_${Date.now()}`;
  const row: CocktailRecipe = { id, itemId: payload.itemId, name: payload.name, ingredients: payload.ingredients || [], notes: payload.notes };
  const list = listRecipes();
  const exist = list.findIndex(r => r.id === id);
  const next = exist >= 0 ? list.map(r => r.id === id ? row : r) : [row, ...list];
  setRecipes(next);
  return row;
};
export const updateRecipe = (row: CocktailRecipe) => setRecipes(listRecipes().map(r => r.id === row.id ? { ...r, ...row } : r));
export const deleteRecipe = (id: string) => setRecipes(listRecipes().filter(r => r.id !== id));
export const getRecipeByItemId = (itemId: string) => listRecipes().find(r => r.itemId === itemId);

export const computeCostPerCocktail = (recipe: CocktailRecipe): number => {
  const ings = listIngredients();
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

export const recordUsage = (itemId: string, count: number, recipe: CocktailRecipe) => {
  const entry = { id: `USE_${Date.now()}`, itemId, count, ts: new Date().toISOString(), recipeId: recipe.id, ingredients: recipe.ingredients };
  const list = readJSON<any[]>(K_USE, []);
  writeJSON(K_USE, [entry, ...list].slice(0, 2000));
};
export const listUsageInRange = (startISO: string, endISO: string): any[] => {
  const list = readJSON<any[]>(K_USE, []);
  const start = new Date(startISO + 'T00:00:00'); const end = new Date(endISO + 'T23:59:59');
  return list.filter(u => { const dt = new Date(u.ts); return dt >= start && dt <= end; });
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

const K_WASTE = 'corepms_cocktail_waste';

export const logWaste = (ingredientId: string, qty: number, reason: string, bartenderId?: string): WasteEntry => {
  // Deduct from ingredient stock
  const ingredient = getIngredientById(ingredientId);
  if (!ingredient) {
    throw new Error('Ingredient not found');
  }
  
  updateIngredient({
    ...ingredient,
    stockQty: Math.max(0, ingredient.stockQty - qty)
  });
  
  // Log waste entry
  const wasteEntry: WasteEntry = {
    id: `WASTE_${Date.now()}`,
    ingredientId,
    qty,
    reason,
    ts: new Date().toISOString(),
    bartenderId
  };
  
  const entries = readJSON<WasteEntry[]>(K_WASTE, []);
  writeJSON(K_WASTE, [wasteEntry, ...entries].slice(0, 500));
  
  // Add audit entry
  try {
    const audit = {
      id: `AUD_${Date.now()}`,
      action: 'INGREDIENT_WASTE',
      entity: 'COCKTAIL',
      timestamp: new Date().toISOString(),
      details: { ingredientId, qty, reason, ingredientName: ingredient.name }
    };
    const ar = localStorage.getItem('corepms_pos_audit');
    const al = ar ? JSON.parse(ar) : [];
    localStorage.setItem('corepms_pos_audit', JSON.stringify([audit, ...al].slice(0, 500)));
  } catch {}
  
  return wasteEntry;
};

export const listWasteEntries = (startISO?: string, endISO?: string): WasteEntry[] => {
  const entries = readJSON<WasteEntry[]>(K_WASTE, []);
  
  if (!startISO || !endISO) {
    return entries;
  }
  
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T23:59:59');
  
  return entries.filter(entry => {
    const entryDate = new Date(entry.ts);
    return entryDate >= start && entryDate <= end;
  });
};

// Reorder suggestions
export interface ReorderSuggestion {
  ingredient: Ingredient;
  priority: 'urgent' | 'medium' | 'low';
  suggestedOrderQty: number;
  daysUntilEmpty?: number;
}

export const getReorderSuggestions = (): ReorderSuggestion[] => {
  const ingredients = listIngredients();
  const suggestions: ReorderSuggestion[] = [];
  
  // Get usage data from last 30 days for trend analysis
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const recentUsage = listUsageInRange(thirtyDaysAgo.toISOString().split('T')[0], now.toISOString().split('T')[0]);
  
  ingredients.forEach(ingredient => {
    // Check if below threshold
    if (ingredient.threshold && ingredient.stockQty <= ingredient.threshold) {
      // Calculate average daily usage
      const ingredientUsage = recentUsage
        .flatMap(entry => entry.ingredients || [])
        .filter(ing => ing.ingredientId === ingredient.id)
        .reduce((sum, ing) => {
          const mlQty = toMl(ing.qty, ing.unit);
          const baseQty = fromMl(mlQty, ingredient.unit);
          return sum + baseQty;
        }, 0);
      
      const dailyUsage = ingredientUsage / 30; // Average per day
      const daysUntilEmpty = dailyUsage > 0 ? ingredient.stockQty / dailyUsage : Infinity;
      
      // Determine priority
      let priority: 'urgent' | 'medium' | 'low' = 'low';
      if (ingredient.stockQty === 0 || daysUntilEmpty < 3) {
        priority = 'urgent';
      } else if (daysUntilEmpty < 7) {
        priority = 'medium';
      }
      
      // Suggest ordering enough for 2 weeks based on usage pattern
      const suggestedOrderQty = Math.max(
        ingredient.threshold * 2, // At least double the threshold
        dailyUsage * 14 // Or 2 weeks worth
      );
      
      suggestions.push({
        ingredient,
        priority,
        suggestedOrderQty: Math.round(suggestedOrderQty),
        daysUntilEmpty: daysUntilEmpty === Infinity ? undefined : Math.round(daysUntilEmpty)
      });
    }
  });
  
  // Sort by priority (urgent first) then by days until empty
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

// Recipe cost calculation
export const calculateRecipeCost = (recipeId: string): number => {
  const recipe = getRecipeById(recipeId);
  if (!recipe) return 0;
  
  return recipe.ingredients.reduce((total, recipeIngredient) => {
    const ingredient = getIngredientById(recipeIngredient.ingredientId);
    if (!ingredient) return total;
    
    // Convert recipe ingredient quantity to ingredient's base unit for cost calculation
    const mlQty = toMl(recipeIngredient.qty, recipeIngredient.unit);
    const baseQty = fromMl(mlQty, ingredient.unit);
    
    return total + (baseQty * ingredient.costPerUnit);
  }, 0);
};

export const decrementIngredientsForCocktail = (itemId: string, count: number): { alerts: string[] } => {
  const recipe = getRecipeByItemId(itemId);
  if (!recipe) return { alerts: [] };
  const ings = listIngredients();
  const alerts: string[] = [];
  const next = ings.map(ing => {
    const ri = recipe.ingredients.find(r => r.ingredientId === ing.id);
    if (!ri) return ing;
    // Convert recipe qty to ingredient unit
    let qtyInIngUnit = ri.qty;
    if (ing.unit !== ri.unit && (ing.unit !== 'each' && ri.unit !== 'each')) {
      const ml = toMl(ri.qty, ri.unit);
      qtyInIngUnit = fromMl(ml, ing.unit);
    }
    const used = qtyInIngUnit * count;
    const updatedQty = Math.max(0, Number(ing.stockQty || 0) - used);
    const updated: Ingredient = { ...ing, stockQty: updatedQty };
    if (typeof ing.threshold === 'number' && updatedQty <= ing.threshold!) alerts.push(`Ingredient '${ing.name}' low: ${updatedQty} ${ing.unit}`);
    return updated;
  });
  setIngredients(next);
  recordUsage(itemId, count, recipe);
  // Audit
  try {
    const audit = { id: `AUD_${Date.now()}`, action: 'INGREDIENT_DEPLETION', entity: 'COCKTAIL', timestamp: new Date().toISOString(), details: { itemId, count, recipe: recipe.id } };
    const ar = localStorage.getItem('corepms_pos_audit'); const al = ar ? JSON.parse(ar) : [];
    localStorage.setItem('corepms_pos_audit', JSON.stringify([audit, ...al].slice(0, 500)));
  } catch {}
  return { alerts };
};

export const restoreIngredientsForCocktail = (itemId: string, count: number) => {
  const recipe = getRecipeByItemId(itemId);
  if (!recipe) return;
  const ings = listIngredients();
  const next = ings.map(ing => {
    const ri = recipe.ingredients.find(r => r.ingredientId === ing.id);
    if (!ri) return ing;
    let qtyInIngUnit = ri.qty;
    if (ing.unit !== ri.unit && (ing.unit !== 'each' && ri.unit !== 'each')) {
      const ml = toMl(ri.qty, ri.unit);
      qtyInIngUnit = fromMl(ml, ing.unit);
    }
    const add = qtyInIngUnit * count;
    return { ...ing, stockQty: Number(ing.stockQty || 0) + add };
  });
  setIngredients(next);
  try {
    const audit = { id: `AUD_${Date.now()}`, action: 'INGREDIENT_RESTORE', entity: 'COCKTAIL', timestamp: new Date().toISOString(), details: { itemId, count, recipe: recipe.id } };
    const ar = localStorage.getItem('corepms_pos_audit'); const al = ar ? JSON.parse(ar) : [];
    localStorage.setItem('corepms_pos_audit', JSON.stringify([audit, ...al].slice(0, 500)));
  } catch {}
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
