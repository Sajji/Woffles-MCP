import { isReadOnly } from '../config.js';
import { getAssetTypesTool, executeGetAssetTypes } from './get-asset-types.js';
import { queryAssetsTool, executeQueryAssets } from './query-assets.js';
import { searchAssetsByNameTool, executeSearchAssetsByName } from './search-assets-by-name.js';
import { getAssetByIdTool, executeGetAssetById } from './get-asset-by-id.js';
import { getAssetRelationsTool, executeGetAssetRelations } from './get-asset-relations.js';
import { getDomainsTool, executeGetDomains } from './get-domains.js';
import { getCommunitiesTool, executeGetCommunities } from './get-communities.js';
import { getAssetResponsibilitiesTool, executeGetAssetResponsibilities } from './get-asset-responsibilities.js';
import { updateAssetDescriptionTool, executeUpdateAssetDescription } from './update-asset-description.js';
import { bulkUpdateAssetDescriptionsTool, executeBulkUpdateAssetDescriptions } from './bulk-update-asset-descriptions.js';
import { getAttributeTypesTool, executeGetAttributeTypes } from './get-attribute-types.js';
import { updateAssetAttributeTool, executeUpdateAssetAttribute } from './update-asset-attribute.js';
import { bulkUpdateAssetAttributesTool, executeBulkUpdateAssetAttributes } from './bulk-update-asset-attributes.js';
import { getRelationTypesTool, executeGetRelationTypes } from './get-relation-types.js';
import { getTableSemanticsTool, executeGetTableSemantics } from './get-table-semantics.js';
import { getBusinessTermDataTool, executeGetBusinessTermData } from './get-business-term-data.js';
import { getLineageUpstreamTool, executeGetLineageUpstream } from './get-lineage-upstream.js';
import { getLineageDownstreamTool, executeGetLineageDownstream } from './get-lineage-downstream.js';
import { getLineageEntityTool, executeGetLineageEntity } from './get-lineage-entity.js';
import { searchLineageEntitiesTool, executeSearchLineageEntities } from './search-lineage-entities.js';
import { prepareCreateAssetTool, executePrepareCreateAsset } from './prepare-create-asset.js';
import { createAssetTool, executeCreateAsset } from './create-asset.js';
import { prepareAddBusinessTermTool, executePrepareAddBusinessTerm } from './prepare-add-business-term.js';
import { addBusinessTermTool, executeAddBusinessTerm } from './add-business-term.js';
import { searchDataClassTool, executeSearchDataClass } from './search-data-class.js';
import { addDataClassificationMatchTool, executeAddDataClassificationMatch } from './add-data-classification-match.js';
import { searchDataClassificationMatchTool, executeSearchDataClassificationMatch } from './search-data-classification-match.js';
import { removeDataClassificationMatchTool, executeRemoveDataClassificationMatch } from './remove-data-classification-match.js';
import { listDataContractTool, executeListDataContract } from './list-data-contract.js';
import { pushDataContractManifestTool, executePushDataContractManifest } from './push-data-contract-manifest.js';
import { pullDataContractManifestTool, executePullDataContractManifest } from './pull-data-contract-manifest.js';
import { getColumnSemanticsTool, executeGetColumnSemantics } from './get-column-semantics.js';
import { getMeasureDataTool, executeGetMeasureData } from './get-measure-data.js';
import { getLineageTransformationTool, executeGetLineageTransformation } from './get-lineage-transformation.js';
import { searchLineageTransformationsTool, executeSearchLineageTransformations } from './search-lineage-transformations.js';
import { listAssessmentsTool, executeListAssessments } from './list-assessments.js';
import { getAssessmentTool, executeGetAssessment } from './get-assessment.js';
import { getAssessmentByReviewTool, executeGetAssessmentByReview } from './get-assessment-by-review.js';
import { listAssessmentTemplatesTool, executeListAssessmentTemplates } from './list-assessment-templates.js';
import { getAssessmentTemplateTool, executeGetAssessmentTemplate } from './get-assessment-template.js';
import { listAssessmentAttachmentsTool, executeListAssessmentAttachments } from './list-assessment-attachments.js';
import { createAssessmentTool, executeCreateAssessment } from './create-assessment.js';
import { updateAssessmentTool, executeUpdateAssessment } from './update-assessment.js';
import { retakeAssessmentTool, executeRetakeAssessment } from './retake-assessment.js';
import { getApiCatalogTool, executeGetApiCatalog } from './get-api-catalog.js';
import { getDomainTypesTool, executeGetDomainTypes } from './get-domain-types.js';
import { getAssetStatusesTool, executeGetAssetStatuses } from './get-asset-statuses.js';
import { createCommunityTool, executeCreateCommunity } from './create-community.js';
import { createDomainTool, executeCreateDomain } from './create-domain.js';
import { createRelationTool, executeCreateRelation } from './create-relation.js';
import { createAssetTypeTool, executeCreateAssetType } from './create-asset-type.js';
import { createRelationTypeTool, executeCreateRelationType } from './create-relation-type.js';

// Write tools that are disabled when readOnly mode is enabled
const WRITE_TOOL_NAMES = [
  'update_asset_description',
  'bulk_update_asset_descriptions',
  'update_asset_attribute',
  'bulk_update_asset_attributes',
  'create_asset',
  'add_business_term',
  'add_data_classification_match',
  'remove_data_classification_match',
  'push_data_contract_manifest',
  'create_assessment',
  'update_assessment',
  'retake_assessment',
  'create_community',
  'create_domain',
  'create_relation',
  'create_asset_type',
  'create_relation_type',
];

const allTools = [
  getAssetTypesTool,
  queryAssetsTool,
  searchAssetsByNameTool,
  getAssetByIdTool,
  getAssetRelationsTool,
  getDomainsTool,
  getCommunitiesTool,
  getAssetResponsibilitiesTool,
  updateAssetDescriptionTool,
  bulkUpdateAssetDescriptionsTool,
  getAttributeTypesTool,
  updateAssetAttributeTool,
  bulkUpdateAssetAttributesTool,
  getRelationTypesTool,
  getTableSemanticsTool,
  getBusinessTermDataTool,
  getLineageUpstreamTool,
  getLineageDownstreamTool,
  getLineageEntityTool,
  searchLineageEntitiesTool,
  prepareCreateAssetTool,
  createAssetTool,
  prepareAddBusinessTermTool,
  addBusinessTermTool,
  searchDataClassTool,
  addDataClassificationMatchTool,
  searchDataClassificationMatchTool,
  removeDataClassificationMatchTool,
  listDataContractTool,
  pushDataContractManifestTool,
  pullDataContractManifestTool,
  getColumnSemanticsTool,
  getMeasureDataTool,
  getLineageTransformationTool,
  searchLineageTransformationsTool,
  listAssessmentsTool,
  getAssessmentTool,
  getAssessmentByReviewTool,
  listAssessmentTemplatesTool,
  getAssessmentTemplateTool,
  listAssessmentAttachmentsTool,
  createAssessmentTool,
  updateAssessmentTool,
  retakeAssessmentTool,
  getApiCatalogTool,
  getDomainTypesTool,
  getAssetStatusesTool,
  createCommunityTool,
  createDomainTool,
  createRelationTool,
  createAssetTypeTool,
  createRelationTypeTool,
];

export const tools = isReadOnly()
  ? allTools.filter(t => !WRITE_TOOL_NAMES.includes(t.name))
  : allTools;

// Tool executor map
export const toolExecutors: Record<string, (args: any) => Promise<string>> = {
  get_asset_types: executeGetAssetTypes,
  query_assets: executeQueryAssets,
  search_assets_by_name: executeSearchAssetsByName,
  get_asset_by_id: executeGetAssetById,
  get_asset_relations: executeGetAssetRelations,
  get_domains: executeGetDomains,
  get_communities: executeGetCommunities,
  get_asset_responsibilities: executeGetAssetResponsibilities,
  update_asset_description: executeUpdateAssetDescription,
  bulk_update_asset_descriptions: executeBulkUpdateAssetDescriptions,
  get_attribute_types: executeGetAttributeTypes,
  update_asset_attribute: executeUpdateAssetAttribute,
  bulk_update_asset_attributes: executeBulkUpdateAssetAttributes,
  get_relation_types: executeGetRelationTypes,
  get_table_semantics: executeGetTableSemantics,
  get_business_term_data: executeGetBusinessTermData,
  get_lineage_upstream: executeGetLineageUpstream,
  get_lineage_downstream: executeGetLineageDownstream,
  get_lineage_entity: executeGetLineageEntity,
  search_lineage_entities: executeSearchLineageEntities,
  prepare_create_asset: executePrepareCreateAsset,
  create_asset: executeCreateAsset,
  prepare_add_business_term: executePrepareAddBusinessTerm,
  add_business_term: executeAddBusinessTerm,
  search_data_class: executeSearchDataClass,
  add_data_classification_match: executeAddDataClassificationMatch,
  search_data_classification_match: executeSearchDataClassificationMatch,
  remove_data_classification_match: executeRemoveDataClassificationMatch,
  list_data_contract: executeListDataContract,
  push_data_contract_manifest: executePushDataContractManifest,
  pull_data_contract_manifest: executePullDataContractManifest,
  get_column_semantics: executeGetColumnSemantics,
  get_measure_data: executeGetMeasureData,
  get_lineage_transformation: executeGetLineageTransformation,
  search_lineage_transformations: executeSearchLineageTransformations,
  list_assessments: executeListAssessments,
  get_assessment: executeGetAssessment,
  get_assessment_by_review: executeGetAssessmentByReview,
  list_assessment_templates: executeListAssessmentTemplates,
  get_assessment_template: executeGetAssessmentTemplate,
  list_assessment_attachments: executeListAssessmentAttachments,
  create_assessment: executeCreateAssessment,
  update_assessment: executeUpdateAssessment,
  retake_assessment: executeRetakeAssessment,
  get_api_catalog:   executeGetApiCatalog,
  get_domain_types: executeGetDomainTypes,
  get_asset_statuses: executeGetAssetStatuses,
  create_community: executeCreateCommunity,
  create_domain: executeCreateDomain,
  create_relation: executeCreateRelation,
  create_asset_type: executeCreateAssetType,
  create_relation_type: executeCreateRelationType,
};

// Helper function to execute a tool by name
export async function executeTool(toolName: string, args: any): Promise<string> {
  if (isReadOnly() && WRITE_TOOL_NAMES.includes(toolName)) {
    throw new Error(
      `Tool "${toolName}" is disabled: this server is running in read-only mode. ` +
      `Set "readOnly": false in config.json to enable write operations.`
    );
  }

  const executor = toolExecutors[toolName];
  
  if (!executor) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  
  return await executor(args);
}
