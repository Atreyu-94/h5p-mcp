/** Native H5P params and the Lumi CJS boundary are schema-dependent. */
export type Native = any;
export type Pointer = Array<string | number>;
export interface Activity {
 title: string; library: string; params: Record<string,Native>; language: string; license: string;
 assets?: Record<string,string>; preparation?: Native;
}
export interface CoreRequest {
 action: 'compile'|'catalog'|'discover'|'schema'|'prepare'|'export'|'validate'|'setup'|'inspect-archive';
 backend?: 'native-content';
 export_mode?: 'content-only'|'with-libraries';
 data_dir: string; source?: Native; activity?: Activity; path?: string; machine_name?: string;
 major_version?: number; minor_version?: number; query?: string; offset?: number; limit?: number;
 installed_only?: boolean; refresh?: boolean; install_if_missing?: boolean; packages?: string[];
}
export interface Reply { id: string; ok: boolean; result?: unknown; code?: string; errors?: string[]; details?: unknown }
