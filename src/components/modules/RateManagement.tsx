import React from 'react';
import ratePlanService, { RatePlanConfig } from '@/lib/ratePlanService';
import { breakfastPackageService } from '@/lib/breakfastPackageService';
import { ORIGIN_REGIONS } from '@/data/regions';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

const RateManagement: React.FC = () => {
  const [config, setConfig] = React.useState<RatePlanConfig>(ratePlanService.getConfig());
  const [newRoomType, setNewRoomType] = React.useState('');
  const [newRoomRate, setNewRoomRate] = React.useState('');
  const [newSeason, setNewSeason] = React.useState({
    key: 'low' as RatePlanConfig['seasons'][number]['key'],
    name: '',
    startMonthDay: '01-01',
    endMonthDay: '01-31',
    adjustment: 0,
  });

  // Breakfast Package States
  const [breakfastPackages, setBreakfastPackages] = React.useState<any[]>([]);
  const [loadingBreakfastPackages, setLoadingBreakfastPackages] = React.useState(true);
  const [newBreakfastPackage, setNewBreakfastPackage] = React.useState({
    code: '',
    name: '',
    description: '',
    basePricePerPerson: '',
    isActive: true,
    maxAdults: '2',
    maxChildren: '2',
    minAdults: '1',
    appliesToAllRoomTypes: true
  });
  const [editingPackageId, setEditingPackageId] = React.useState<string | null>(null);
  const [breakfastSeasonalRates, setBreakfastSeasonalRates] = React.useState<Record<string, any[]>>({});

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Validation helpers
  const MIN_PERCENT = -90; // lower bound for percent inputs
  const MAX_PERCENT = 300; // upper bound for percent inputs
  const isValidMonthDay = (s: string) => /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(s);

  // Load breakfast packages on component mount
  React.useEffect(() => {
    loadBreakfastPackages();
  }, []);

  const loadBreakfastPackages = async () => {
    try {
      setLoadingBreakfastPackages(true);
      const packages = await breakfastPackageService.getAllPackages();
      setBreakfastPackages(packages);

      // Load seasonal rates for each package
      const seasonalRatesData: Record<string, any[]> = {};
      for (const pkg of packages) {
        const rates = await breakfastPackageService.getSeasonalRates(pkg.id);
        seasonalRatesData[pkg.id] = rates;
      }

      setBreakfastSeasonalRates(seasonalRatesData);
    } catch (error) {
      console.error('Failed to load breakfast packages:', error);
    } finally {
      setLoadingBreakfastPackages(false);
    }
  };

  type Validation = {
    hasErrors: boolean;
    messages: string[];
    baseRateErrors: Record<string, string>;
    regionErrors: Record<string, string>;
    seasonErrors: Record<number, { startMonthDay?: string; endMonthDay?: string; adjustment?: string }>;
  };

  const validateConfig = (cfg: RatePlanConfig): Validation => {
    const messages: string[] = [];
    const baseRateErrors: Record<string, string> = {};
    const regionErrors: Record<string, string> = {};
    const seasonErrors: Record<number, { startMonthDay?: string; endMonthDay?: string; adjustment?: string }> = {};

    // Base rates must be non-negative finite numbers
    Object.entries(cfg.baseRates).forEach(([roomType, rate]) => {
      if (!Number.isFinite(rate) || rate < 0) {
        baseRateErrors[roomType] = 'Rate must be a non-negative number.';
        messages.push(`Base rate invalid for "${roomType}"`);
      }
    });

    // Region adjustments percent bounds
    ORIGIN_REGIONS.forEach((region) => {
      const pct = Math.round(((cfg.regionAdjustments[region] ?? 0) * 100) * 100) / 100; // 2dp
      if (!Number.isFinite(pct) || pct < MIN_PERCENT || pct > MAX_PERCENT) {
        regionErrors[region] = `Percent must be between ${MIN_PERCENT}% and ${MAX_PERCENT}%.`;
        messages.push(`Region percent out of range for "${region}"`);
      }
    });

    // Seasons validation: date format and percent bounds
    cfg.seasons.forEach((s, idx) => {
      const errs: { startMonthDay?: string; endMonthDay?: string; adjustment?: string } = {};
      if (!isValidMonthDay(s.startMonthDay)) {
        errs.startMonthDay = 'Use MM-DD format (e.g., 12-15).';
        messages.push(`Season ${idx + 1}: invalid start date`);
      }
      if (!isValidMonthDay(s.endMonthDay)) {
        errs.endMonthDay = 'Use MM-DD format (e.g., 01-15).';
        messages.push(`Season ${idx + 1}: invalid end date`);
      }
      const adjPct = Math.round(((s.adjustment ?? 0) * 100) * 100) / 100;
      if (!Number.isFinite(adjPct) || adjPct < MIN_PERCENT || adjPct > MAX_PERCENT) {
        errs.adjustment = `Percent must be between ${MIN_PERCENT}% and ${MAX_PERCENT}%.`;
        messages.push(`Season ${idx + 1}: adjustment out of range`);
      }
      if (Object.keys(errs).length) seasonErrors[idx] = errs;
    });

    return {
      hasErrors: messages.length > 0,
      messages,
      baseRateErrors,
      regionErrors,
      seasonErrors,
    };
  };

  const validation = React.useMemo(() => validateConfig(config), [config]);

  const updateBaseRate = (roomType: string, rateStr: string) => {
    const rate = Math.max(0, Number(rateStr) || 0);
    setConfig(prev => ({ ...prev, baseRates: { ...prev.baseRates, [roomType]: rate } }));
  };

  const addBaseRate = () => {
    const name = newRoomType.trim();
    const rate = Math.max(0, Number(newRoomRate) || 0);
    if (!name) return;
    setConfig(prev => ({ ...prev, baseRates: { ...prev.baseRates, [name]: rate } }));
    setNewRoomType('');
    setNewRoomRate('');
  };

  const removeBaseRate = (roomType: string) => {
    setConfig(prev => {
      const next = { ...prev, baseRates: { ...prev.baseRates } };
      delete next.baseRates[roomType];
      return next;
    });
  };

  const updateRegionAdj = (region: string, percentStr: string) => {
    // Accept percent input; store as decimal multiplier
    const pct = Number(percentStr);
    const decimal = isNaN(pct) ? 0 : pct / 100;
    setConfig(prev => ({ ...prev, regionAdjustments: { ...prev.regionAdjustments, [region]: decimal } }));
  };

  const updateSeason = (index: number, field: keyof RatePlanConfig['seasons'][number], value: string | number) => {
    setConfig(prev => {
      const seasons = [...prev.seasons];
      const current = { ...seasons[index] } as RatePlanConfig['seasons'][number];
      // Basic coercion
      if (field === 'adjustment') {
        current.adjustment = typeof value === 'number' ? value : (Number(value) || 0);
      } else if (field === 'key') {
        current.key = value as any;
      } else if (field === 'name') {
        current.name = String(value);
      } else if (field === 'startMonthDay' || field === 'endMonthDay') {
        current[field] = String(value);
      }
      seasons[index] = current;
      return { ...prev, seasons };
    });
  };

  const addSeason = () => {
    // basic validation before adding
    if (!isValidMonthDay(newSeason.startMonthDay) || !isValidMonthDay(newSeason.endMonthDay)) {
      alert('Season dates must use MM-DD format (e.g., 12-15).');
      return;
    }
    setConfig(prev => ({ ...prev, seasons: [...prev.seasons, { ...newSeason }] }));
    setNewSeason({ key: 'low', name: '', startMonthDay: '01-01', endMonthDay: '01-31', adjustment: 0 });
  };

  const removeSeason = (index: number) => {
    setConfig(prev => ({ ...prev, seasons: prev.seasons.filter((_, i) => i !== index) }));
  };

  const saveAll = () => {
    if (validation.hasErrors) {
      alert('Please fix validation errors before saving.');
      return;
    }
    ratePlanService.saveConfig(config);
    alert('Rate plan saved successfully');
  };

  // Import/Export handlers
  const exportConfig = () => {
    try {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rate-plan-config.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export config.');
    }
  };

  const triggerImport = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // minimal shape validation and coercion
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
      const next: RatePlanConfig = {
        baseRates: Object.fromEntries(Object.entries(parsed.baseRates || {}).map(([k, v]) => [String(k), Number(v) || 0])),
        regionAdjustments: Object.fromEntries(Object.entries(parsed.regionAdjustments || {}).map(([k, v]) => [String(k), Number(v) || 0])),
        seasons: Array.isArray(parsed.seasons) ? parsed.seasons.map((s: any) => ({
          key: (s.key === 'high' || s.key === 'shoulder' || s.key === 'low') ? s.key : 'low',
          name: String(s.name || ''),
          startMonthDay: String(s.startMonthDay || '01-01'),
          endMonthDay: String(s.endMonthDay || '01-31'),
          adjustment: Number(s.adjustment) || 0,
        })) : [],
      };
      const v = validateConfig(next);
      setConfig(next);
      if (v.hasErrors) {
        alert('Imported config has validation issues. Please review the highlighted fields.');
      } else {
        alert('Rate plan imported successfully');
      }
    } catch (err) {
      alert('Failed to import JSON. Ensure it matches the RatePlanConfig shape.');
    } finally {
      // reset input value to allow reimporting same file
      e.target.value = '';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 text-3xl font-bold text-gray-800 py-3">Rate Management</h2>
      <p className="text-sm text-gray-600">Configure base room rates, regional adjustments, and seasonal adjustments. These settings affect automatic rate calculations in Reservations.</p>

      {validation.hasErrors && (
        <Card className="border-red-300">
          <CardHeader>
            <CardTitle className="text-red-700">Validation Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm text-red-700">
              {validation.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Base Rates */}
      <Card>
        <CardHeader>
          <CardTitle>Base Room Rates</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room Type</TableHead>
                <TableHead className="text-right">Nightly Rate</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(config.baseRates).map(([roomType, rate]) => (
                <TableRow key={roomType}>
                  <TableCell className="font-medium">{roomType}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      title={`Nightly Rate for ${roomType}`}
                      type="number"
                      value={rate}
                      onChange={(e) => updateBaseRate(roomType, e.target.value)}
                      className="w-32 ml-auto"
                    />
                    {validation.baseRateErrors[roomType] && (
                      <div className="text-xs text-red-600 mt-1">{validation.baseRateErrors[roomType]}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => removeBaseRate(roomType)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <Input id="new-room-type" title="New Room Type" placeholder="New room type" value={newRoomType} onChange={(e) => setNewRoomType(e.target.value)} />
                </TableCell>
                <TableCell className="text-right">
                  <Input id="new-room-rate" title="New Room Rate" type="number" placeholder="Rate" value={newRoomRate} onChange={(e) => setNewRoomRate(e.target.value)} className="w-32 ml-auto" />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" onClick={addBaseRate}>Add</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Regional Adjustments */}
      <Card>
        <CardHeader>
          <CardTitle>Regional Adjustments</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-500 mb-3">Enter percentage adjustments per origin region (e.g., 10 for +10%, -5 for -5%).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ORIGIN_REGIONS.map(region => (
              <div key={region} className="p-3 border rounded">
                <Label htmlFor={`adj-${region}`} className="text-xs">{region}</Label>
                <Input
                  id={`adj-${region}`}
                  type="number"
                  value={Math.round((config.regionAdjustments[region] || 0) * 100)}
                  onChange={(e) => updateRegionAdj(region, e.target.value)}
                />
                {validation.regionErrors[region] && (
                  <div className="text-xs text-red-600 mt-1">{validation.regionErrors[region]}</div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Seasons */}
      <Card>
        <CardHeader>
          <CardTitle>Seasonal Adjustments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Start (MM-DD)</TableHead>
                <TableHead>End (MM-DD)</TableHead>
                <TableHead className="text-right">Adj %</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.seasons.map((s, idx) => (
                <TableRow key={`${s.key}-${idx}`}>
                  <TableCell>
                    <select className="border rounded px-2 py-1" value={s.key} onChange={(e) => updateSeason(idx, 'key', e.target.value)}>
                      <option value="low">low</option>
                      <option value="shoulder">shoulder</option>
                      <option value="high">high</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input value={s.name} onChange={(e) => updateSeason(idx, 'name', e.target.value)} />
                  </TableCell>
                  <TableCell>
                    <Input value={s.startMonthDay} onChange={(e) => updateSeason(idx, 'startMonthDay', e.target.value)} />
                    {validation.seasonErrors[idx]?.startMonthDay && (
                      <div className="text-xs text-red-600 mt-1">{validation.seasonErrors[idx]?.startMonthDay}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input value={s.endMonthDay} onChange={(e) => updateSeason(idx, 'endMonthDay', e.target.value)} />
                    {validation.seasonErrors[idx]?.endMonthDay && (
                      <div className="text-xs text-red-600 mt-1">{validation.seasonErrors[idx]?.endMonthDay}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      value={Math.round((s.adjustment || 0) * 100)}
                      onChange={(e) => updateSeason(idx, 'adjustment', (Number(e.target.value) || 0) / 100)}
                      className="w-24 ml-auto"
                    />
                    {validation.seasonErrors[idx]?.adjustment && (
                      <div className="text-xs text-red-600 mt-1">{validation.seasonErrors[idx]?.adjustment}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => removeSeason(idx)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <select className="border rounded px-2 py-1" value={newSeason.key} onChange={(e) => setNewSeason(prev => ({ ...prev, key: e.target.value as any }))}>
                    <option value="low">low</option>
                    <option value="shoulder">shoulder</option>
                    <option value="high">high</option>
                  </select>
                </TableCell>
                <TableCell>
                  <Input placeholder="Name" value={newSeason.name} onChange={(e) => setNewSeason(prev => ({ ...prev, name: e.target.value }))} />
                </TableCell>
                <TableCell>
                  <Input placeholder="MM-DD" value={newSeason.startMonthDay} onChange={(e) => setNewSeason(prev => ({ ...prev, startMonthDay: e.target.value }))} />
                </TableCell>
                <TableCell>
                  <Input placeholder="MM-DD" value={newSeason.endMonthDay} onChange={(e) => setNewSeason(prev => ({ ...prev, endMonthDay: e.target.value }))} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" placeholder="Adj %" value={Math.round(newSeason.adjustment * 100)} onChange={(e) => setNewSeason(prev => ({ ...prev, adjustment: (Number(e.target.value) || 0) / 100 }))} className="w-24 ml-auto" />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" onClick={addSeason}>Add</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Breakfast Packages */}
      <Card>
        <CardHeader>
          <CardTitle>Breakfast Packages</CardTitle>
          <p className="text-sm text-gray-600">Configure breakfast package options and their seasonal pricing</p>
        </CardHeader>
        <CardContent>
          {loadingBreakfastPackages ? (
            <div className="text-center py-4">Loading breakfast packages...</div>
          ) : (
            <>
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-3">Add New Breakfast Package</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <Label htmlFor="bb-code">Code *</Label>
                    <Input
                      id="bb-code"
                      value={newBreakfastPackage.code}
                      onChange={(e) => setNewBreakfastPackage(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                      placeholder="e.g., BB"
                    />
                  </div>
                  <div>
                    <Label htmlFor="bb-name">Name *</Label>
                    <Input
                      id="bb-name"
                      value={newBreakfastPackage.name}
                      onChange={(e) => setNewBreakfastPackage(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Bed & Breakfast"
                    />
                  </div>
                  <div>
                    <Label htmlFor="bb-price">Base Price per Person ($)</Label>
                    <Input
                      id="bb-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={newBreakfastPackage.basePricePerPerson}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || (!isNaN(Number(val)) && Number(val) >= 0)) {
                          setNewBreakfastPackage(prev => ({ ...prev, basePricePerPerson: val }));
                        }
                      }}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={newBreakfastPackage.isActive}
                        onCheckedChange={(checked) => setNewBreakfastPackage(prev => ({ ...prev, isActive: checked }))}
                      />
                      <Label htmlFor="bb-active">Active</Label>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    onClick={async () => {
                      if (!newBreakfastPackage.code || !newBreakfastPackage.name) {
                        alert('Please enter both code and name');
                        return;
                      }
                      try {
                        await breakfastPackageService.createPackage({
                          code: newBreakfastPackage.code,
                          name: newBreakfastPackage.name,
                          description: newBreakfastPackage.description,
                          basePrice: Number(newBreakfastPackage.basePricePerPerson) || 0,
                          adultPrice: Number(newBreakfastPackage.basePricePerPerson) || 0,
                          childPrice: Number(newBreakfastPackage.basePricePerPerson) || 0,
                          applicableRoomTypes: [],
                          isActive: newBreakfastPackage.isActive,
                          sortOrder: breakfastPackages.length + 1
                        });
                        setNewBreakfastPackage({
                          code: '',
                          name: '',
                          description: '',
                          basePricePerPerson: '',
                          isActive: true,
                          maxAdults: '2',
                          maxChildren: '2',
                          minAdults: '1',
                          appliesToAllRoomTypes: true
                        });
                        await loadBreakfastPackages();
                      } catch (error) {
                        console.error('Failed to create breakfast package:', error);
                        alert('Failed to create breakfast package');
                      }
                    }}
                  >
                    Add Package
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium mb-3">Existing Packages</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Base Price</TableHead>
                      <TableHead>Seasonal Rates</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakfastPackages.map(pkg => (
                      <TableRow key={pkg.id}>
                        <TableCell className="font-medium">{pkg.code}</TableCell>
                        <TableCell>{pkg.name}</TableCell>
                        <TableCell>${pkg.basePrice.toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {breakfastSeasonalRates[pkg.id]?.map(rate => (
                              <div key={rate.id} className="text-xs">
                                {rate.seasonKey}: {(rate.priceMultiplier * 100).toFixed(0)}%
                              </div>
                            )) || <span className="text-xs text-gray-500">No seasonal rates</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={pkg.isActive ? "default" : "secondary"}>
                            {pkg.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-2"
                            onClick={async () => {
                              try {
                                await breakfastPackageService.deletePackage(pkg.id);
                                await loadBreakfastPackages();
                              } catch (error) {
                                console.error('Failed to delete package:', error);
                                alert('Failed to delete package');
                              }
                            }}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              // TODO: Implement edit functionality
                              alert('Edit functionality coming soon');
                            }}
                          >
                            Edit Rates
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardFooter className="flex justify-between gap-2 items-center">
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportConfig}>Export JSON</Button>
            <Button variant="outline" onClick={triggerImport}>Import JSON</Button>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} title="Import JSON File" />
          </div>
          <div className="flex items-center gap-3">
            {validation.hasErrors && (
              <span className="text-xs text-red-600">Fix validation issues to enable saving.</span>
            )}
            <Button onClick={saveAll} disabled={validation.hasErrors}>Save Rate Plan</Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

export default RateManagement;
