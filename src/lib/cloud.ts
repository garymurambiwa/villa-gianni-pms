// Local-only operation - no cloud services
// This file provides stubs for cloud functionality that is not used in LAN mode

export type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns?: string) => any;
    insert: (rows: any) => any;
    update: (vals: any) => any;
    upsert: (rows: any) => any;
    eq: (col: string, val: any) => any;
    in: (col: string, vals: any[]) => any;
    single: () => any;
  };
};

// No cloud client in LAN mode
export const getSupabaseClient = async (): Promise<SupabaseClientLike | null> => {
  return null;
};

// Cloud is never configured in LAN-only mode
export const isCloudConfigured = (): boolean => {
  return false;
};
