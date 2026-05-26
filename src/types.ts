// Configuration types
export interface CollibraInstance {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  insecure?: boolean;
}

/**
 * Standard return shape for tool executors that opt in to structured output.
 * Tools may still return a plain string for backward compatibility — the
 * dispatcher will treat that as `{ text: <string> }`.
 */
export interface ToolResult {
  /** Human-readable text content (typically JSON.stringify of `structured`). */
  text: string;
  /** Parseable object emitted via MCP `structuredContent`. */
  structured?: unknown;
}

export interface CollibraConfig {
  instances: CollibraInstance[];
  readOnly?: boolean;
  warning?: string;
  warningIcon?: string;
}

// Asset Type types
export interface AssetTypeParent {
  id: string;
  resourceType: string;
  resourceDiscriminator: string;
  name: string;
}

export interface AssetTypeSymbolData {
  color: string;
  symbolType: string;
  acronymCode?: string;
}

export interface AssetType {
  id: string;
  createdBy: string;
  createdOn: number;
  lastModifiedBy: string;
  lastModifiedOn: number;
  system: boolean;
  resourceType: string;
  name: string;
  description?: string;
  publicId: string;
  parent?: AssetTypeParent;
  symbolData?: AssetTypeSymbolData;
  displayNameEnabled: boolean;
  ratingEnabled: boolean;
  finalType: boolean;
  lockStatuses: boolean;
  product: string;
  appliedTraits: any[];
}

export interface AssetTypesResponse {
  total: number;
  offset: number;
  limit: number;
  results: AssetType[];
}

// GraphQL Asset types
export interface AttributeType {
  name: string;
}

export interface StringAttribute {
  type: AttributeType;
  stringValue: string;
}

export interface BooleanAttribute {
  type: AttributeType;
  booleanValue: boolean;
}

export interface NumericAttribute {
  type: AttributeType;
  numericValue: number;
}

export interface DateAttribute {
  type: AttributeType;
  dateValue: string;
}

export interface MultiValueAttribute {
  type: AttributeType;
  stringValues: string[];
}

export interface Responsibility {
  role: {
    name: string;
  };
  user: {
    fullName: string;
  };
}

export interface AssetType_GraphQL {
  name: string;
}

export interface AssetStatus {
  name: string;
}

export interface Tag {
  name: string;
}

export interface AssetDomain {
  name: string;
}

// Lightweight asset returned by the summary query
export interface AssetSummary {
  id: string;
  displayName: string;
  fullName: string;
  type: AssetType_GraphQL;
  status: AssetStatus;
  domain: AssetDomain;
}

// Full asset returned by the full-detail query
export interface Asset {
  id: string;
  displayName: string;
  fullName: string;
  type: AssetType_GraphQL;
  status: AssetStatus;
  domain: AssetDomain;
  stringAttributes: StringAttribute[];
  booleanAttributes: BooleanAttribute[];
  numericAttributes: NumericAttribute[];
  dateAttributes: DateAttribute[];
  multiValueAttributes: MultiValueAttribute[];
  responsibilities: Responsibility[];
  tags: Tag[];
}

export interface AssetsResponse {
  assets: Asset[];
}

export interface GraphQLResponse {
  data: AssetsResponse;
}
