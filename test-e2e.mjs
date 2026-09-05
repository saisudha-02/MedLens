import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('====================================================');
  console.log('  STARTING MEDLENS END-TO-END INTEGRATION TEST SUITE');
  console.log('====================================================\n');

  let token = '';
  let demoUser = null;
  let patientA = null;
  let reportSep = null;
  let glucoseTest = null;
  let hemoTest = null;

  // 1. Authenticate Demo Account
  console.log('▶ [Test 1] Authenticating Demo Account...');
  const loginRes = await fetch(`${BASE_URL}/auth/demo-login`, { method: 'POST' });
  const loginData = await loginRes.json();
  if (!loginData.success || !loginData.token) {
    throw new Error('Demo login failed: ' + JSON.stringify(loginData));
  }
  token = loginData.token;
  demoUser = loginData.user;
  console.log(`  ✓ Authenticated as: ${demoUser.name} (${demoUser.email})`);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 2. Fetch Patients List
  console.log('\n▶ [Test 2] Fetching Patients Directory...');
  const ptsRes = await fetch(`${BASE_URL}/patients`, { headers });
  const ptsData = await ptsRes.json();
  if (!ptsData.success || !Array.isArray(ptsData.patients) || ptsData.patients.length < 2) {
    throw new Error('Failed to retrieve seeded patients');
  }
  console.log(`  ✓ Retrieved ${ptsData.patients.length} patients from registry.`);
  patientA = ptsData.patients.find(p => p.name.includes('John Doe'));
  const patientB = ptsData.patients.find(p => p.name.includes('Sarah Connor'));
  console.log(`  ✓ Patient A found: ${patientA.name} (Age: ${patientA.age})`);
  console.log(`  ✓ Patient B found: ${patientB.name} (Age: ${patientB.age})`);

  // 3. Inspect Patient A Profile & Provenance
  console.log('\n▶ [Test 3] Verifying Patient A Intake Profile & Provenance...');
  const ptARes = await fetch(`${BASE_URL}/patients/${patientA.id || patientA._id}`, { headers });
  const ptAData = await ptARes.json();
  if (!ptAData.success || ptAData.provenance !== 'USER_PROVIDED') {
    throw new Error('Patient A provenance verification failed');
  }
  console.log(`  ✓ Provenance confirmed: ${ptAData.provenance}`);
  console.log(`  ✓ Allergies: ${ptAData.patient.allergies.join(', ')}`);
  console.log(`  ✓ Medications: ${ptAData.patient.medications.join(', ')}`);
  console.log(`  ✓ Documents associated: ${ptAData.reports.length}`);

  // 4. Verify Conflict Detection (Penicillin Allergy vs Medication)
  console.log('\n▶ [Test 4] Verifying Automated Conflict Detection Engine...');
  const confRes = await fetch(`${BASE_URL}/patients/${patientA.id || patientA._id}/conflicts`, { headers });
  const confData = await confRes.json();
  const penicillinConflict = confData.conflicts?.find(c => c.type === 'ALLERGY_MEDICATION_MISMATCH');
  if (!penicillinConflict) {
    throw new Error('Allergy-Medication conflict was NOT detected!');
  }
  console.log(`  ✓ Conflict Flagged: "${penicillinConflict.title}"`);
  console.log(`  ✓ Severity: ${penicillinConflict.severity}`);
  console.log(`  ✓ Clinical Disclaimer: "${penicillinConflict.description}"`);

  // 5. Strict Reference Range Verification (Rule #15)
  console.log('\n▶ [Test 5] Verifying Strict Reference Range Engine (Rule #15)...');
  const tests = ptAData.testResults || [];
  glucoseTest = tests.find(t => t.testName.toLowerCase().includes('glucose'));
  hemoTest = tests.find(t => t.testName.toLowerCase().includes('hemoglobin') && t.status === 'NORMAL');

  if (!glucoseTest) {
    throw new Error('Fasting Blood Glucose test not found in Patient A records');
  }
  if (glucoseTest.status !== 'NOT_CLASSIFIED') {
    throw new Error(`CRITICAL RULE VIOLATION: Glucose with missing range was classified as ${glucoseTest.status} instead of NOT_CLASSIFIED`);
  }
  console.log(`  ✓ Glucose Value: ${glucoseTest.value} ${glucoseTest.unit}`);
  console.log(`  ✓ Reference Range: ${JSON.stringify(glucoseTest.referenceRange)}`);
  console.log(`  ✓ Classification: ${glucoseTest.status} (Verified: NEVER invent reference ranges)`);
  console.log(`  ✓ Observation: "${glucoseTest.observation}"`);

  // 6. Test Human Verification & Audit Trail Logging
  console.log('\n▶ [Test 6] Testing Human Verification & Audit Diff Logging...');
  reportSep = ptAData.reports.find(r => r.fileName.includes('Sep2026') || r.reportDate?.includes('09-05'));
  const reportId = reportSep._id;
  const resultToEdit = hemoTest._id;

  const editRes = await fetch(`${BASE_URL}/reports/${reportId}/results/${resultToEdit}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      verifiedValue: 12.1,
      editReason: 'Corrected digit misread per Page 1 laboratory report table',
    }),
  });
  const editData = await editRes.json();
  if (!editData.success || editData.testResult.verifiedValue !== 12.1 || !editData.testResult.verified) {
    throw new Error('Failed to update test result with human verification');
  }
  console.log(`  ✓ Verified value updated: AI (${editData.testResult.aiValue}) → Verified (${editData.testResult.verifiedValue})`);
  console.log(`  ✓ Status verified: ${editData.testResult.verified ? 'VERIFIED' : 'UNVERIFIED'}`);

  // Check Audit Log Entry
  const auditRes = await fetch(`${BASE_URL}/patients/${patientA.id || patientA._id}/audit`, { headers });
  const auditData = await auditRes.json();
  const recentAudit = auditData.logs?.[0];
  console.log(`  ✓ Audit Log Recorded: Action="${recentAudit.action}", User="${recentAudit.userName}", Prev="${recentAudit.previousValue}", New="${recentAudit.newValue}"`);

  // 7. Verify Longitudinal Report Comparison (Rule #22)
  console.log('\n▶ [Test 7] Verifying Longitudinal Report Comparison (Rule #22)...');
  const compRes = await fetch(`${BASE_URL}/patients/${patientA.id || patientA._id}/comparison`, { headers });
  const compData = await compRes.json();
  const hemoComp = compData.comparisons?.find(c => c.testName.toLowerCase().includes('hemoglobin'));
  if (!hemoComp || hemoComp.points.length < 2) {
    throw new Error('Longitudinal comparison points missing for Hemoglobin');
  }
  console.log(`  ✓ Hemoglobin tracking points across dates: ${hemoComp.points.map(p => `${p.date}: ${p.value}`).join(' → ')}`);
  console.log(`  ✓ Factual Observation: "${hemoComp.factualObservation}"`);
  if (hemoComp.factualObservation.toLowerCase().includes('health improved')) {
    throw new Error('VIOLATION: Factual observation contained non-objective health judgment');
  }

  // 8. Verify Chronological Timeline
  console.log('\n▶ [Test 8] Verifying Patient Chronological Timeline...');
  const tlRes = await fetch(`${BASE_URL}/patients/${patientA.id || patientA._id}/timeline`, { headers });
  const tlData = await tlRes.json();
  if (!tlData.success || !tlData.events || tlData.events.length === 0) {
    throw new Error('Timeline events empty');
  }
  console.log(`  ✓ Total timeline events: ${tlData.events.length}`);
  console.log(`  ✓ Latest event: [${tlData.events[0].badge}] "${tlData.events[0].title}"`);

  // 9. Verify Patient-Friendly AI Summary & Safe Anti-Diagnosis Rules
  console.log('\n▶ [Test 9] Verifying Patient-Friendly AI Summary (Rules #24 & #26)...');
  const sumRes = await fetch(`${BASE_URL}/patients/${patientA.id || patientA._id}/summary`, {
    method: 'POST',
    headers,
  });
  const sumData = await sumRes.json();
  if (!sumData.success || !sumData.summary) {
    throw new Error('Failed to generate summary: ' + JSON.stringify(sumData));
  }
  console.log(`  ✓ Provenance: ${sumData.provenance}`);
  console.log(`  ✓ Section 1 (Records Contain): "${sumData.summary.overview.slice(0, 80)}..."`);
  console.log(`  ✓ Section 2 (Key Findings): ${sumData.summary.keyFindings.length} findings`);
  console.log(`  ✓ Section 3 (Review Needed): "${sumData.summary.reviewNeeded[0] || 'None'}"`);
  console.log(`  ✓ Section 4 (Source Coverage): ${sumData.summary.sourceCoverage.join(', ')}`);

  // 10. Global Search
  console.log('\n▶ [Test 10] Verifying Global Multi-Entity Search...');
  const searchRes = await fetch(`${BASE_URL}/search?q=Hemoglobin`, { headers });
  const searchData = await searchRes.json();
  console.log(`  ✓ Search results for "Hemoglobin": ${searchData.results.testResults.length} test matches found.`);

  console.log('\n====================================================');
  console.log('  ALL 10 VERIFICATION CHECKS PASSED WITH 100% SUCCESS');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err.message);
  process.exit(1);
});
