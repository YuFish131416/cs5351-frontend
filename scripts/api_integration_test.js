#!/usr/bin/env node
const axios = require('axios');

const fs = require('fs');
const path = require('path');
const BASE = process.env.TDM_API_BASE || 'http://localhost:8000/api/v1';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for long-running analysis

function log(...args) { console.log('[api-test]', ...args); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function healthCheck() {
  log('Checking base URL:', BASE);
  try {
    const r = await axios.get(`${BASE}/`);
    log('GET / ->', r.status);
    return true;
  } catch (err) {
    log('GET / failed, trying /projects');
    try {
      const r = await axios.get(`${BASE}/projects`);
      log('GET /projects ->', r.status);
      return true;
    } catch (err2) {
      console.error('Health check failed:', err2.message);
      return false;
    }
  }
}

async function listProjects() {
  const r = await axios.get(`${BASE}/projects`);
  return r.data;
}

async function createProject(sample) {
  const r = await axios.post(`${BASE}/projects/`, sample);
  return r.data;
}

async function triggerAnalysis(projectId, filePath) {
  const url = `${BASE}/projects/${projectId}/analysis`;
  const r = await axios.post(url, filePath ? { file_path: filePath } : {});
  return r.data; // { task_id, status, message }
}

async function getAnalysisStatus(projectId, analysisId) {
  const url = `${BASE}/projects/${projectId}/analysis/${analysisId}`;
  const r = await axios.get(url);
  return r.data;
}

async function getDebtSummary(projectId) {
  const r = await axios.get(`${BASE}/projects/${projectId}/debt-summary`);
  return r.data;
}

async function getProjectDebts(projectId) {
  const r = await axios.get(`${BASE}/debts/project/${projectId}`);
  return r.data;
}

async function getFileDebts(projectId, filePath) {
  const r = await axios.get(`${BASE}/debts/project/${projectId}`, { params: { file_path: filePath } });
  return r.data;
}

async function run() {
  log('Starting API integration test');
  // Quick local checks: compiled bundle exists and package.json main points to it
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const mainField = pkg.main;
    log('package.json main ->', mainField);
    const bundlePath = path.join(__dirname, '..', mainField || 'dist/extension.js');
    if (!fs.existsSync(bundlePath)) {
      console.warn('Warning: compiled bundle not found at', bundlePath, '\nPlease run `npm run compile` before running this test.');
    } else {
      log('Found compiled bundle at', bundlePath);
    }
  } catch (err) {
    console.warn('Could not read package.json:', err.message);
  }

  const ok = await healthCheck();
  if (!ok) {
    console.error('Backend not reachable at', BASE);
    process.exit(2);
  }

  // list projects
  log('Listing projects...');
  let projects = await listProjects();
  log('Projects count:', Array.isArray(projects) ? projects.length : 'unknown');

  // create a sample project
  const sampleName = `tdm-test-${Date.now()}`;
  const sample = {
    name: sampleName,
    localPath: process.cwd(),
    language: 'javascript'
  };

  log('Creating project:', sampleName);
  const created = await createProject(sample);
  log('Created project id:', created.id || created.project_id || JSON.stringify(created));
  const projectId = created.id || created.project_id;
  if (!projectId) {
    console.error('Server did not return project id in response:', created);
    process.exit(3);
  }

  // trigger project analysis
  log('Triggering analysis for project', projectId);
  const trigger = await triggerAnalysis(projectId);
  log('Trigger response:', trigger);
  const analysisId = trigger.task_id || trigger.id || trigger.analysis_id || trigger.taskId;
  if (!analysisId) {
    console.warn('No analysis id returned, test will continue but cannot poll status. Response:', trigger);
  } else {
    // poll until completed or timeout
    log('Polling analysis status for id:', analysisId);
    const start = Date.now();
    let status = null;
    while (Date.now() - start < TIMEOUT_MS) {
      try {
        const stat = await getAnalysisStatus(projectId, analysisId);
        status = stat.status || stat.state || JSON.stringify(stat);
        log('Analysis status:', status);
        if (status === 'completed' || status === 'done' || status === 'success') {
          break;
        }
        if (status === 'failed' || status === 'error') {
          console.error('Analysis failed:', stat);
          break;
        }
      } catch (err) {
        log('Polling error:', err.message);
      }
      await sleep(5000);
    }
    log('Final analysis status:', status);
  }

  // debt summary
  try {
    const summary = await getDebtSummary(projectId);
    log('Debt summary:', summary);
  } catch (err) {
    console.warn('Debt summary fetch failed:', err.message);
  }

  // project debts
  try {
    const debts = await getProjectDebts(projectId);
    log('Project debts count:', Array.isArray(debts) ? debts.length : JSON.stringify(debts));
  } catch (err) {
    console.warn('Get project debts failed:', err.message);
  }

  // try file debts for README.md (likely present)
  try {
    const fileDebts = await getFileDebts(projectId, 'README.md');
    log('File debts for README.md:', Array.isArray(fileDebts) ? fileDebts.length : JSON.stringify(fileDebts));
  } catch (err) {
    console.warn('Get file debts failed:', err.message);
  }

  log('API integration test finished');
}

run().catch(err => {
  console.error('Unhandled error in API test:', err);
  process.exit(1);
});
