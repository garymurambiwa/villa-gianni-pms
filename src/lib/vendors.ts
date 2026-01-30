export interface Vendor { id: string; name: string; currency?: string; terms?: string }

const VENDORS_KEY = 'corepms_vendors';
const readJSON = <T>(k:string,f:T):T=>{ try{ const r=localStorage.getItem(k); return r? JSON.parse(r) as T : f; }catch{ return f; } };
const writeJSON = (k:string,v:any)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

export const listVendors = (): Vendor[] => readJSON<Vendor[]>(VENDORS_KEY, [
  { id:'V001', name:'ABC Supplies', currency:'USD', terms:'Net 30' },
  { id:'V002', name:'Electric Co.', currency:'USD', terms:'Net 15' },
  { id:'V003', name:'Laundry Services', currency:'USD', terms:'Net 30' },
]);

export const addVendor = (name: string, currency?: string, terms?: string): Vendor => {
  const v = { id:`V${Date.now()}`, name, currency, terms } as Vendor;
  const next = [v, ...listVendors()]; writeJSON(VENDORS_KEY, next); return v;
};

export default { listVendors, addVendor };

