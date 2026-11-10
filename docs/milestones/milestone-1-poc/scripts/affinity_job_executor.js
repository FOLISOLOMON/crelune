/**
 * CRELUNE â€” Affinity 3.3 Milestone 1 Automation Proof of Concept
 *
 * Demonstrates safe document inspection, targeted layer text replacement,
 * and high-fidelity rendering/exporting using official Canva Affinity 3.3
 * JSLib APIs.
 */

'use strict';

const { Application } = require('/application.js');
const { Document, FileExportOptions, FileExportArea } = require('/document.js');
const { EnumerationResult } = require('affinity:common');

/**
 * Execute job manifest operations on working copy.
 * @param {Object} jobConfig - Serialized manifest data
 * @returns {Object} Execution report
 */
function executeJob(jobConfig) {
    const report = {
        jobId: jobConfig.jobId,
        startTime: new Date().toISOString(),
        steps: [],
        mutations: [],
        success: false
    };

    try {
        // Step 1: Open working copy document
        report.steps.push({ step: 'load_document', path: jobConfig.workingDocumentPath });
        const doc = Document.load(jobConfig.workingDocumentPath);
        if (!doc) {
            throw new Error(`Failed to load working document at: ${jobConfig.workingDocumentPath}`);
        }

        // Step 2: Traverse document tree to map layers
        report.steps.push({ step: 'map_layer_tree' });
        const layerMap = new Map();

        function visitNode(node) {
            if (!node) return;
            const desc = node.descriptionInterface?.userDescription || node.descriptionInterface?.description;
            if (desc) {
                layerMap.set(desc.toLowerCase().trim(), node);
            }
            // Recurse children
            if (node.children) {
                for (let i = 0; i < node.children.count; i++) {
                    visitNode(node.children.item(i));
                }
            }
        }

        visitNode(doc.rootNode);

        // Step 3: Apply field replacements
        for (const field of jobConfig.fields) {
            const targetKey = field.layerName.toLowerCase().trim();
            const targetNode = layerMap.get(targetKey);

            if (targetNode && field.action === 'replace_text') {
                targetNode.setText(field.value);
                report.mutations.push({
                    layerName: field.layerName,
                    action: field.action,
                    value: field.value,
                    status: 'APPLIED'
                });
            } else {
                report.mutations.push({
                    layerName: field.layerName,
                    action: field.action,
                    status: targetNode ? 'UNSUPPORTED_ACTION' : 'LAYER_NOT_FOUND'
                });
            }
        }

        // Step 4: Export to deliverable
        report.steps.push({ step: 'export_deliverable', outputPath: jobConfig.outputPath });
        const exportOptions = FileExportOptions.createWithPresetName(jobConfig.export.preset || 'PNG');
        const exportArea = FileExportArea.createForWholeDocument();

        const exportRecords = doc.export(jobConfig.outputPath, exportOptions, exportArea, null);

        let exportSuccess = false;
        exportRecords.enumerate(record => {
            if (record.isSuccess) {
                exportSuccess = true;
            }
            return EnumerationResult.Continue;
        });

        // Step 5: Save working copy and close
        doc.saveAs(jobConfig.workingDocumentPath);
        doc.close();

        report.success = exportSuccess;
        report.endTime = new Date().toISOString();
        return report;
    } catch (err) {
        report.error = err.message || String(err);
        report.endTime = new Date().toISOString();
        return report;
    }
}

module.exports = { executeJob };
