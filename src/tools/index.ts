import { isReadOnly, isToolEnabledByConfig, getStarWarsSource, getToolToggles, loadConfig } from '../config.js';
import { normalizeInputSchema, validateToolArgs } from '../utils/validation.js';
import { WRITE_TOOL_NAMES, annotationsFor, humanizeToolName } from './annotations.js';
import type { ToolResult } from '../types.js';
import { getInstancesTool, executeGetInstances } from './get-instances.js';
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
import { getLineageTool, executeGetLineage } from './get-lineage.js';
import { getAssetSemanticsTool, executeGetAssetSemantics } from './get-asset-semantics.js';
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
import { initDataContractTool, executeInitDataContract } from './init-data-contract.js';
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
import { editAssessmentTool, executeEditAssessment } from './edit-assessment.js';
import { retakeAssessmentTool, executeRetakeAssessment } from './retake-assessment.js';
import { getApiCatalogTool, executeGetApiCatalog } from './get-api-catalog.js';
import { getDomainTypesTool, executeGetDomainTypes } from './get-domain-types.js';
import { getAssetStatusesTool, executeGetAssetStatuses } from './get-asset-statuses.js';
import { createCommunityTool, executeCreateCommunity } from './create-community.js';
import { createDomainTool, executeCreateDomain } from './create-domain.js';
import { createRelationTool, executeCreateRelation } from './create-relation.js';
import { createAssetTypeTool, executeCreateAssetType } from './create-asset-type.js';
import { createRelationTypeTool, executeCreateRelationType } from './create-relation-type.js';
import { refreshOperatingModelTool, executeRefreshOperatingModel } from './refresh-operating-model.js';
import { getOperatingModelSummaryTool, executeGetOperatingModelSummary } from './get-operating-model-summary.js';
import { describeAssetTypeTool, executeDescribeAssetType } from './describe-asset-type.js';
import { describeDomainTypeTool, executeDescribeDomainType } from './describe-domain-type.js';
import { resolveModelTermTool, executeResolveModelTerm } from './resolve-model-term.js';
import { planAssetCreationTool, executePlanAssetCreation } from './plan-asset-creation.js';
import { findTraversalPathTool, executeFindTraversalPath } from './find-traversal-path.js';
import { validateAgainstModelTool, executeValidateAgainstModel } from './validate-against-model.js';
import { bulkCreateAssetsTool, executeBulkCreateAssets } from './bulk-create-assets.js';
import { bulkCreateRelationsTool, executeBulkCreateRelations } from './bulk-create-relations.js';
import { bulkDeleteAssetsTool, executeBulkDeleteAssets, bulkDeleteRelationsTool, executeBulkDeleteRelations } from './bulk-delete.js';
import { editAssetTool, executeEditAsset } from './edit-asset.js';
import { planWriteOperationTool, executePlanWriteOperation } from './plan-write-operation.js';
import { createAttributeTypeTool, executeCreateAttributeType } from './create-attribute-type.js';
import { assignAttributeToAssetTypeTool, executeAssignAttributeToAssetType } from './assign-attribute-to-asset-type.js';
import { searchStarWarsTool, executeSearchStarWars } from './search-star-wars.js';
import { searchSubjectTool, executeSearchSubject } from './search-subject.js';
import { searchCatalogColumnsTool, executeSearchCatalogColumns } from './search-catalog-columns.js';
import { findWorkflowDefinitionsTool, executeFindWorkflowDefinitions } from './find-workflow-definitions.js';
import { findWorkflowTasksTool, executeFindWorkflowTasks } from './find-workflow-tasks.js';
import { startWorkflowInstanceTool, executeStartWorkflowInstance } from './start-workflow-instance.js';
import { completeWorkflowTaskTool, executeCompleteWorkflowTask } from './complete-workflow-task.js';
import { findCommentsTool, executeFindComments } from './find-comments.js';
import { addCommentTool, executeAddComment } from './add-comment.js';
import { getActivitiesTool, executeGetActivities } from './get-activities.js';
import { exportOutputModuleTool, executeExportOutputModule } from './export-output-module.js';
import { findTagsTool, executeFindTags } from './find-tags.js';
import { findMappingsTool, executeFindMappings } from './find-mappings.js';
import { addMappingTool, executeAddMapping } from './add-mapping.js';
import { removeMappingTool, executeRemoveMapping } from './remove-mapping.js';
import { getAssetViewStatsTool, executeGetAssetViewStats } from './get-asset-view-stats.js';
import { getContentUsageTool, executeGetContentUsage } from './get-content-usage.js';
import { getUserUsageTool, executeGetUserUsage } from './get-user-usage.js';
import { getAssetUsageTool, executeGetAssetUsage } from './get-asset-usage.js';
import { findComplexRelationsTool, executeFindComplexRelations } from './find-complex-relations.js';
import { findUsersTool, executeFindUsers } from './find-users.js';
import { findRatingsTool, executeFindRatings } from './find-ratings.js';
import { listCollibraSkillsTool, executeListCollibraSkills, loadCollibraSkillTool, executeLoadCollibraSkill } from './collibra-skills.js';
import { listContextSpecificationsTool, executeListContextSpecifications, getContextSpecificationTool, executeGetContextSpecification } from './context-specifications.js';
import { getAuditLogTool, executeGetAuditLog } from './get-audit-log.js';
import { undoWriteTool, executeUndoWrite } from './undo-write.js';
import { auditedExecute } from '../utils/audited-execute.js';
import { errorResult } from './_context.js';

/** A tool executor: returns plain text (legacy) or a ToolResult with structuredContent. */
type Executor = (args: any) => Promise<string | ToolResult>;

/**
 * Every canonical tool as [definition, executor] — the single source of truth.
 * Order is the tools/list order. Write tools (hidden in readOnly mode) and their
 * MCP annotation hints live in annotations.ts.
 */
const TOOL_DEFINITIONS: Array<[any, Executor]> = [
  [getInstancesTool, executeGetInstances],
  [getAssetTypesTool, executeGetAssetTypes],
  [queryAssetsTool, executeQueryAssets],
  [searchAssetsByNameTool, executeSearchAssetsByName],
  [getAssetByIdTool, executeGetAssetById],
  [getAssetRelationsTool, executeGetAssetRelations],
  [getDomainsTool, executeGetDomains],
  [getCommunitiesTool, executeGetCommunities],
  [getAssetResponsibilitiesTool, executeGetAssetResponsibilities],
  [updateAssetDescriptionTool, executeUpdateAssetDescription],
  [bulkUpdateAssetDescriptionsTool, executeBulkUpdateAssetDescriptions],
  [getAttributeTypesTool, executeGetAttributeTypes],
  [updateAssetAttributeTool, executeUpdateAssetAttribute],
  [bulkUpdateAssetAttributesTool, executeBulkUpdateAssetAttributes],
  [getRelationTypesTool, executeGetRelationTypes],
  [getAssetSemanticsTool, executeGetAssetSemantics],
  [getTableSemanticsTool, executeGetTableSemantics],
  [getBusinessTermDataTool, executeGetBusinessTermData],
  [getLineageTool, executeGetLineage],
  [getLineageUpstreamTool, executeGetLineageUpstream],
  [getLineageDownstreamTool, executeGetLineageDownstream],
  [getLineageEntityTool, executeGetLineageEntity],
  [searchLineageEntitiesTool, executeSearchLineageEntities],
  [prepareCreateAssetTool, executePrepareCreateAsset],
  [createAssetTool, executeCreateAsset],
  [prepareAddBusinessTermTool, executePrepareAddBusinessTerm],
  [addBusinessTermTool, executeAddBusinessTerm],
  [searchDataClassTool, executeSearchDataClass],
  [addDataClassificationMatchTool, executeAddDataClassificationMatch],
  [searchDataClassificationMatchTool, executeSearchDataClassificationMatch],
  [removeDataClassificationMatchTool, executeRemoveDataClassificationMatch],
  [listDataContractTool, executeListDataContract],
  [pushDataContractManifestTool, executePushDataContractManifest],
  [pullDataContractManifestTool, executePullDataContractManifest],
  [initDataContractTool, executeInitDataContract],
  [getColumnSemanticsTool, executeGetColumnSemantics],
  [getMeasureDataTool, executeGetMeasureData],
  [getLineageTransformationTool, executeGetLineageTransformation],
  [searchLineageTransformationsTool, executeSearchLineageTransformations],
  [listAssessmentsTool, executeListAssessments],
  [getAssessmentTool, executeGetAssessment],
  [getAssessmentByReviewTool, executeGetAssessmentByReview],
  [listAssessmentTemplatesTool, executeListAssessmentTemplates],
  [getAssessmentTemplateTool, executeGetAssessmentTemplate],
  [listAssessmentAttachmentsTool, executeListAssessmentAttachments],
  [createAssessmentTool, executeCreateAssessment],
  [updateAssessmentTool, executeUpdateAssessment],
  [editAssessmentTool, executeEditAssessment],
  [retakeAssessmentTool, executeRetakeAssessment],
  [getApiCatalogTool, executeGetApiCatalog],
  [getDomainTypesTool, executeGetDomainTypes],
  [getAssetStatusesTool, executeGetAssetStatuses],
  [createCommunityTool, executeCreateCommunity],
  [createDomainTool, executeCreateDomain],
  [createRelationTool, executeCreateRelation],
  [createAssetTypeTool, executeCreateAssetType],
  [createRelationTypeTool, executeCreateRelationType],
  [refreshOperatingModelTool, executeRefreshOperatingModel],
  [getOperatingModelSummaryTool, executeGetOperatingModelSummary],
  [describeAssetTypeTool, executeDescribeAssetType],
  [describeDomainTypeTool, executeDescribeDomainType],
  [resolveModelTermTool, executeResolveModelTerm],
  [planAssetCreationTool, executePlanAssetCreation],
  [findTraversalPathTool, executeFindTraversalPath],
  [validateAgainstModelTool, executeValidateAgainstModel],
  [bulkCreateAssetsTool, executeBulkCreateAssets],
  [bulkCreateRelationsTool, executeBulkCreateRelations],
  [bulkDeleteAssetsTool, executeBulkDeleteAssets],
  [bulkDeleteRelationsTool, executeBulkDeleteRelations],
  [editAssetTool, executeEditAsset],
  [planWriteOperationTool, executePlanWriteOperation],
  [createAttributeTypeTool, executeCreateAttributeType],
  [assignAttributeToAssetTypeTool, executeAssignAttributeToAssetType],
  [searchStarWarsTool, executeSearchStarWars],
  [searchSubjectTool, executeSearchSubject],
  [searchCatalogColumnsTool, executeSearchCatalogColumns],
  [findWorkflowDefinitionsTool, executeFindWorkflowDefinitions],
  [findWorkflowTasksTool, executeFindWorkflowTasks],
  [startWorkflowInstanceTool, executeStartWorkflowInstance],
  [completeWorkflowTaskTool, executeCompleteWorkflowTask],
  [findCommentsTool, executeFindComments],
  [addCommentTool, executeAddComment],
  [getActivitiesTool, executeGetActivities],
  [exportOutputModuleTool, executeExportOutputModule],
  [findTagsTool, executeFindTags],
  [findMappingsTool, executeFindMappings],
  [addMappingTool, executeAddMapping],
  [removeMappingTool, executeRemoveMapping],
  [getAssetViewStatsTool, executeGetAssetViewStats],
  [getContentUsageTool, executeGetContentUsage],
  [getUserUsageTool, executeGetUserUsage],
  [getAssetUsageTool, executeGetAssetUsage],
  [findComplexRelationsTool, executeFindComplexRelations],
  [findUsersTool, executeFindUsers],
  [findRatingsTool, executeFindRatings],
  [listCollibraSkillsTool, executeListCollibraSkills],
  [loadCollibraSkillTool, executeLoadCollibraSkill],
  [listContextSpecificationsTool, executeListContextSpecifications],
  [getContextSpecificationTool, executeGetContextSpecification],
  [getAuditLogTool, executeGetAuditLog],
  [undoWriteTool, executeUndoWrite],
];

const allTools = TOOL_DEFINITIONS.map(([definition]) => definition);

/**
 * Chip-compatible aliases: expose Collibra `chip` tool names that map to this
 * server's canonical read tools, so prompts/clients built against chip work
 * unchanged. Aliases are additive — the canonical names remain the primary API.
 */
const TOOL_ALIASES: { alias: string; canonical: string }[] = [
  { alias: 'list_asset_types', canonical: 'get_asset_types' },
  { alias: 'search_asset_keyword', canonical: 'search_assets_by_name' },
  { alias: 'get_asset_details', canonical: 'get_asset_by_id' },
];

const aliasTools = TOOL_ALIASES.map(({ alias, canonical }) => {
  const base = allTools.find(t => t.name === canonical)!;
  return { ...base, name: alias, description: `[Alias for ${canonical}] ${base.description}` };
});

// Aliases inherit the canonical tool's hints (same executor, same effect).
const aliasCanonical = new Map(TOOL_ALIASES.map(({ alias, canonical }) => [alias, canonical]));

/** Canonical name for a tool or alias. */
const canonicalOf = (name: string) => aliasCanonical.get(name) ?? name;

export const registeredTools = [...allTools, ...aliasTools].map((t: any) => ({
  ...t,
  // Central constraints (UUID patterns, limit/offset bounds) are advertised AND enforced.
  inputSchema: normalizeInputSchema(t.inputSchema),
  annotations: { ...annotationsFor(canonicalOf(t.name)), title: humanizeToolName(t.name) },
}));

/**
 * Per-tool toggles, alias-aware. An alias is the same tool as its canonical
 * name, so: with an allowlist (enabledTools) listing EITHER name enables it;
 * with a denylist (disabledTools) listing EITHER name disables it.
 */
function enabledByToggles(name: string): boolean {
  const canonical = canonicalOf(name);
  if (canonical === name) return isToolEnabledByConfig(name);
  const allowlistMode = getToolToggles().enabled.length > 0;
  return allowlistMode
    ? isToolEnabledByConfig(name) || isToolEnabledByConfig(canonical)
    : isToolEnabledByConfig(name) && isToolEnabledByConfig(canonical);
}

/** Why a tool (or alias) is unavailable, or null when it may be used. Read-only checks the canonical name. */
function unavailableReason(name: string): string | null {
  if (isReadOnly() && WRITE_TOOL_NAMES.includes(canonicalOf(name))) {
    return `Tool "${name}" is disabled: this server is running in read-only mode. ` +
      `Set "readOnly": false in config.json to enable write operations.`;
  }
  if (!enabledByToggles(name)) {
    return `Tool "${name}" is disabled by server configuration ` +
      `(enabledTools/disabledTools or COLLIBRA_ENABLED_TOOLS/COLLIBRA_DISABLED_TOOLS).`;
  }
  return null;
}

/**
 * Legacy tools, superseded by a consolidated tool (value = what to use instead).
 * They remain fully callable — existing prompts, scripts and skills keep
 * working — but are not advertised in tools/list, keeping the surface (and
 * every client's context) smaller. Set `"listLegacyTools": true` in config.json
 * to advertise them again.
 */
export const LEGACY_TOOLS: Record<string, string> = {
  update_asset_description: 'edit_asset (op update_attribute, Description type 00000000-0000-0000-0000-000000003114)',
  update_asset_attribute: 'edit_asset (op update_attribute)',
  bulk_update_asset_descriptions: 'bulk_update_asset_attributes (attribute_type_id 00000000-0000-0000-0000-000000003114)',
  create_asset: 'bulk_create_assets (single-element array)',
  add_business_term: 'bulk_create_assets (asset_type_id 00000000-0000-0000-0000-000000011001)',
  prepare_add_business_term: 'prepare_create_asset (asset_type_name "Business Term")',
  plan_asset_creation: 'prepare_create_asset',
  get_lineage_upstream: 'get_lineage (direction "upstream")',
  get_lineage_downstream: 'get_lineage (direction "downstream")',
  get_table_semantics: 'get_asset_semantics',
  get_column_semantics: 'get_asset_semantics',
  get_business_term_data: 'get_asset_semantics',
  get_measure_data: 'get_asset_semantics',
  update_assessment: 'edit_assessment',
  get_assessment_by_review: 'get_assessment (assessment_review_id)',
  init_data_contract: 'push_data_contract_manifest (mode "init")',
  search_star_wars: 'search_subject',
  plan_write_operation: 'the tool descriptions (bulk_* for many items, edit_asset for many changes to one asset)',
};

const listLegacy = () => loadConfig().listLegacyTools === true;

export const tools = registeredTools
  .filter(t => unavailableReason(t.name) === null)
  // Legacy tools stay callable but are only advertised on request.
  .filter(t => !(t.name in LEGACY_TOOLS) || listLegacy())
  .map(t => (t.name in LEGACY_TOOLS ? { ...t, description: `[Legacy — prefer ${LEGACY_TOOLS[t.name]}] ${t.description}` } : t))
  // Don't advertise the opt-in demo source when it's switched off.
  .filter(t => t.name !== 'search_star_wars' || getStarWarsSource().enabled);
// Tool executor map (canonical names; aliases are added below). Executors may
// return a plain string (legacy) or a ToolResult to also emit structuredContent.
export const toolExecutors: Record<string, Executor> = Object.fromEntries(
  TOOL_DEFINITIONS.map(([definition, execute]) => [definition.name, execute]),
);

// Register alias executors so chip-compatible tool names resolve to the same
// underlying executor as their canonical counterpart.
for (const { alias, canonical } of TOOL_ALIASES) {
  toolExecutors[alias] = toolExecutors[canonical];
}

// Helper function to execute a tool by name. Always returns a normalized
// `ToolResult` regardless of whether the underlying executor returned a
// string (legacy) or a `ToolResult` (refactored tool).
export async function executeTool(toolName: string, args: any): Promise<ToolResult> {
  const executor = toolExecutors[toolName];
  if (!executor) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const reason = unavailableReason(toolName);
  if (reason) throw new Error(reason);

  const canonical = canonicalOf(toolName);
  const inputSchema = registeredTools.find((t) => t.name === toolName)?.inputSchema;
  // Throws ToolInputError (→ MCP isError) before anything reaches Collibra.
  const validArgs = validateToolArgs(toolName, inputSchema, args);
  return auditedExecute(canonical, validArgs, inputSchema, WRITE_TOOL_NAMES.includes(canonical), async () => {
    try {
      const result = await executor(validArgs);
      return typeof result === 'string' ? { text: result } : result;
    } catch (error) {
      // Single error boundary for every tool: a thrown error becomes the
      // standard { error: true, message, instance } result (→ MCP isError).
      return errorResult(error, validArgs);
    }
  });
}
