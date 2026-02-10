import { db, auth } from './firebase-config.js';
import {
    doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, deleteDoc, updateDoc, orderBy, limit, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { testTemplates } from './templates.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { saveProtocol, getProtocols, deleteProtocol, createProtocol } from './protocols.js';
import { getCustomTests, generateTemplate } from './custom_tests.js';
import { graphTemplates } from './graph_templates.js';
import { testConfigs } from './test_config.js';

// --- CONSTANTS ---
const STATIC_TESTS = [
    // STYRKA (Strength)
    { id: 'hipthrust', name: 'Hip Thrusters', category: 'Styrka' },
    { id: 'quads', name: 'Quadriceps Isometrisk', category: 'Styrka' },
    { id: 'staticsquat-handdrag', name: 'Static Squat (Handdrag)', category: 'Styrka' },
    { id: 'staticsquat-hoftrem', name: 'Static Squat (Höftrem)', category: 'Styrka' },
    { id: 'hamstring', name: 'Hamstring Isometrisk', category: 'Styrka' },
    { id: 'nordic-hamstring', name: 'Nordic Hamstrings', category: 'Styrka' },

    // HOPP (Jumps)
    { id: 'cmj', name: 'Max Hopp CMJ (Enbens)', category: 'Hopp' },
    { id: 'cmj2ben', name: 'Max Hopp CMJ (Tvåbens)', category: 'Hopp' },
    { id: 'tia', name: 'Repeterade Hopp (TIA)', category: 'Hopp' },
    { id: 'sidehop', name: 'Sidhopp', category: 'Hopp' },
    { id: 'repeated_bilateral', name: 'Repeated Bilateral Jump', category: 'Hopp' },

    // BALANS & ANALYS (Balance/Analysis)
    { id: 'balance', name: 'Balans (Enbens)', category: 'Balans & Analys' },
    { id: 'squat', name: 'Squat Analytics', category: 'Balans & Analys' },

    // ÖVRIGT (Other)
    { id: 'manual', name: 'Manuella Mätningar', category: 'Övrigt' }
];

// --- STATE ---
window.STATIC_TESTS = STATIC_TESTS;
window.allTests = [...STATIC_TESTS];
let currentPatient = null;
let currentScreeningId = null;
console.log("Index.js: Global allTests initialized", window.allTests);


// --- CHART CREATION FUNCTIONS REMOVED (Now using graph_templates.js) ---

// saveData removed - replaced by async version below in Core Logic

// collectDataFromForm removed (duplicate)

// populateFormFromData removed (duplicate)

// updateManualPreview removed (duplicate)

function updateAsymmetryDisplay(valV, valH, referenceSide, displayId, isLowerBetter = false) {
    const displayEl = document.getElementById(displayId);
    if (!displayEl) return;

    if (valV === 0 || valH === 0 || referenceSide === 'Ingen') {
        displayEl.innerHTML = 'Asymmetri: N/A';
        displayEl.dataset.asymmetryValue = 0;
        return;
    }

    let referenceVal = (referenceSide === 'Vänster') ? valV : valH;
    let otherVal = (referenceSide === 'Vänster') ? valH : valV;

    let asymmetryPercent = ((otherVal - referenceVal) / referenceVal) * 100;
    if (isLowerBetter) {
        asymmetryPercent *= -1;
    }

    const color = asymmetryPercent < -10 ? '#d9534f' : '#5cb85c';
    const asymmetryHTML = `Asymmetri: <span style="color: ${color}; font-weight: bold;">${asymmetryPercent.toFixed(1)}%</span>`;

    displayEl.innerHTML = asymmetryHTML;
    displayEl.dataset.asymmetryValue = asymmetryPercent.toFixed(1);
}

function updateCombinedAsymmetryDisplay(v1, h1, isLowerBetter1, v2, h2, isLowerBetter2, referenceSide, displayId) {
    const displayEl = document.getElementById(displayId);
    if (!displayEl) return;

    const asymmetries = [];

    if (v1 > 0 && h1 > 0 && referenceSide !== 'Ingen') {
        let ref = (referenceSide === 'Vänster') ? v1 : h1;
        let other = (referenceSide === 'Vänster') ? h1 : v1;
        let percent = ((other - ref) / ref) * 100;
        if (isLowerBetter1) percent *= -1;
        asymmetries.push(percent);
    }

    if (v2 > 0 && h2 > 0 && referenceSide !== 'Ingen') {
        let ref = (referenceSide === 'Vänster') ? v2 : h2;
        let other = (referenceSide === 'Vänster') ? h2 : v2;
        let percent = ((other - ref) / ref) * 100;
        if (isLowerBetter2) percent *= -1;
        asymmetries.push(percent);
    }

    if (asymmetries.length === 0) {
        displayEl.innerHTML = 'Asymmetri: N/A';
        displayEl.dataset.asymmetryValue = 0;
        return;
    }

    const avgPercent = asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length;
    const color = avgPercent < -10 ? '#d9534f' : '#5cb85c';
    const asymmetryHTML = `Sammanlagd Asymmetri: <span style="color: ${color}; font-weight: bold;">${avgPercent.toFixed(1)}%</span>`;

    displayEl.innerHTML = asymmetryHTML;
    displayEl.dataset.asymmetryValue = avgPercent.toFixed(1);
}

function updatePreview() {
    const data = collectDataFromForm();
    const referenceSide = data.patientInfo.dominantSide;

    const sections = document.querySelectorAll('.test-section');
    const typeCounts = {};
    const plotlyConfig = { displayModeBar: false, staticPlot: true, responsive: true };

    sections.forEach(sec => {
        const type = sec.dataset.testType;
        const index = sec.dataset.instanceIndex || ''; // e.g. "_0"

        if (!type) return;

        // Determine Data Key logic matching collectDataFromForm
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        const isFirst = typeCounts[type] === 1;

        let key = type;
        if (type === 'repeated_bilateral') key = 'repeatedBilateral';
        if (type === 'cmj2ben') key = 'cmj2ben';
        if (type === 'squat') key = 'squatAnalytics';

        // Page 2 mapping
        let p2key = type;
        if (type === 'hipthrust') p2key = 'hipThrust';
        if (type === 'quads') p2key = 'quadriceps';
        if (type === 'staticsquat-handdrag') p2key = 'staticsquatHanddrag';
        if (type === 'staticsquat-hoftrem') p2key = 'staticsquatHoftrem';
        if (type === 'nordic-hamstring') p2key = 'nordicHamstring';

        let finalKey = key;
        if (!isFirst) finalKey += `_${typeCounts[type] - 1}`;
        let finalP2Key = p2key;
        if (!isFirst) finalP2Key += `_${typeCounts[type] - 1}`;


        let sectionData = null;

        // Find the data object
        if (type === 'manual') {
            if (isFirst) sectionData = data.page2.manual;
            else sectionData = data.page2[finalP2Key];
        } else if (['hipthrust', 'quads', 'staticsquat-handdrag', 'staticsquat-hoftrem', 'hamstring', 'nordic-hamstring'].includes(type) || type === 'manual') {
            if (type !== 'manual') {
                if (isFirst) sectionData = data.page2.strengthTests[p2key];
                else sectionData = data.page2.strengthTests[finalP2Key];
            }
        } else if (type.startsWith('custom_')) {
            // CRITICAL FIX: Custom tests are stored in data.page2.custom[customId]
            const customId = type.replace('custom_', '');
            sectionData = data.page2.custom ? data.page2.custom[customId] : null;
        } else {
            // Page 1
            sectionData = data.page1[finalKey];
        }

        if (!sectionData) return;

        // Render Graph
        const container = sec.querySelector('.graph-container');
        if (container) {
            container.style.display = 'block';

            if (type === 'balance') {
                updateCombinedAsymmetryDisplay(sectionData.leftScore, sectionData.rightScore, false, sectionData.leftDiff, sectionData.rightDiff, true, referenceSide, `asymmetry_balance${index}`);

                const template = graphTemplates[testConfigs.balance.template];
                const chartData = { leftVal1: sectionData.leftScore, rightVal1: sectionData.rightScore, leftVal2: sectionData.leftDiff, rightVal2: sectionData.rightDiff };
                const fig = template.create(chartData, testConfigs.balance.config);
                Plotly.react(`p1-chart-balance${index}`, fig.data, fig.layout, plotlyConfig);

            } else if (type === 'cmj') {
                const avgVJump = (sectionData.vaJumps.reduce((a, b) => a + b, 0) / 3) || 0;
                const avgHJump = (sectionData.hoJumps.reduce((a, b) => a + b, 0) / 3) || 0;
                updateAsymmetryDisplay(avgVJump, avgHJump, referenceSide, `asymmetry_cmj${index}`);

                const template = graphTemplates[testConfigs.cmj.template];
                const chartData = { labels: testConfigs.cmj.config.labels, vaValues: sectionData.vaJumps, hoValues: sectionData.hoJumps };
                const fig = template.create(chartData, testConfigs.cmj.config);
                Plotly.react(`p1-chart-cmj${index}`, fig.data, fig.layout, plotlyConfig);

            } else if (type === 'tia') {
                updateCombinedAsymmetryDisplay(sectionData.leftJump, sectionData.rightJump, true, sectionData.leftGct, sectionData.rightGct, false, referenceSide, `asymmetry_tia${index}`);

                const template = graphTemplates[testConfigs.tia.template];
                const chartData = { leftVal1: sectionData.leftJump, rightVal1: sectionData.rightJump, leftVal2: sectionData.leftGct, rightVal2: sectionData.rightGct };
                const fig = template.create(chartData, testConfigs.tia.config);
                Plotly.react(`p1-chart-tia${index}`, fig.data, fig.layout, plotlyConfig);

            } else if (type === 'sidehop') {
                updateAsymmetryDisplay(sectionData.leftCount, sectionData.rightCount, referenceSide, `asymmetry_sidehop${index}`);

                const template = graphTemplates[testConfigs.sidehop.template];
                const chartData = { leftVal: sectionData.leftCount, rightVal: sectionData.rightCount };
                const fig = template.create(chartData, testConfigs.sidehop.config);
                Plotly.react(`p1-chart-sidehop${index}`, fig.data, fig.layout, plotlyConfig);

            } else if (type === 'squat') {
                const template = graphTemplates[testConfigs.squatAnalytics.template];
                [sectionData.attempt1, sectionData.attempt2, sectionData.attempt3].forEach((val, i) => {
                    const fig = template.create({ value: val }, testConfigs.squatAnalytics.config);
                    Plotly.react(`p1-chart-donut-${i + 1}${index}`, fig.data, fig.layout, plotlyConfig);
                });

            } else if (type === 'repeated_bilateral') {
                const template = graphTemplates[testConfigs.repeatedBilateral.template];
                const chartData = { val1: sectionData.avgHeight, val2: sectionData.avgGct };
                const fig = template.create(chartData, testConfigs.repeatedBilateral.config);
                Plotly.react(`p1-chart-repeated-bilateral${index}`, fig.data, fig.layout, plotlyConfig);

            } else if (type === 'cmj2ben') {
                const template = graphTemplates[testConfigs.cmj2ben.template];
                [sectionData.attempt1, sectionData.attempt2, sectionData.attempt3].forEach((val, i) => {
                    const fig = template.create({ value: val }, testConfigs.cmj2ben.config);
                    Plotly.react(`p1-chart-donut-cmj2ben-${i + 1}${index}`, fig.data, fig.layout, plotlyConfig);
                });

            } else if (['hipthrust', 'quads', 'staticsquat-handdrag', 'staticsquat-hoftrem', 'hamstring'].includes(type)) {
                let chartIdBase = `p2-chart-`;
                let suffix = '';
                if (type === 'hipthrust') suffix = 'hipthrust';
                else if (type === 'quads') suffix = 'quads';
                else if (type === 'staticsquat-handdrag') suffix = 'squat-handdrag';
                else if (type === 'staticsquat-hoftrem') suffix = 'squat-hoftrem';
                else if (type === 'hamstring') suffix = 'hamstring';
                chartIdBase += suffix;

                updateAsymmetryDisplay(sectionData.left, sectionData.right, referenceSide, `asymmetry_${type.replace(/-/g, '_')}${index}`);

                const configKey = p2key;
                const cfg = testConfigs[configKey];
                const template = graphTemplates[cfg.template];
                const chartData = { leftVal1: sectionData.left, rightVal1: sectionData.right };

                const fig = template.create(chartData, cfg.config);
                Plotly.react(`${chartIdBase}${index}`, fig.data, fig.layout, plotlyConfig);

                if (type === 'hipthrust') {
                    updateAnimalOverlay(sectionData.tva, document.getElementById(`overlay-image-hipthrust${index}`), document.getElementById(`overlay-text-hipthrust${index}`));
                } else if (type === 'staticsquat-handdrag') {
                    updateAnimalOverlay(sectionData.both, document.getElementById(`overlay-image-squat-handdrag${index}`), document.getElementById(`overlay-text-squat-handdrag${index}`));
                } else if (type === 'staticsquat-hoftrem') {
                    updateAnimalOverlay(sectionData.both, document.getElementById(`overlay-image-squat-hoftrem${index}`), document.getElementById(`overlay-text-squat-hoftrem${index}`));
                }

            } else if (type === 'nordic-hamstring') {
                const template = graphTemplates[testConfigs.nordicHamstring.template];
                [sectionData.attempt1, sectionData.attempt2, sectionData.attempt3].forEach((val, i) => {
                    const fig = template.create({ value: val }, testConfigs.nordicHamstring.config);
                    Plotly.react(`p2-chart-donut-nordic-${i + 1}${index}`, fig.data, fig.layout, plotlyConfig);
                });

            } else if (type.startsWith('custom_')) {
                const customId = type.replace('custom_', '');
                if (sectionData && sectionData.active) {
                    const chartId = `custom-chart-${customId}${index}`;
                    const container = document.getElementById(chartId);

                    if (container) {
                        const testDef = allTests.find(t => t.id === customId);
                        if (testDef) {
                            const config = {
                                yAxisTitle: testDef.config.yAxisTitle,
                                metricNames: testDef.config.metricNames || ['Värde 1'],
                                metricName: (testDef.config.metricNames || ['Värde 1'])[0], // For single-bar template
                                inputLabels: testDef.config.inputLabels,
                                labels: testDef.config.inputLabels, // Map to labels for templates
                                decimals: 1,
                                // Pass other config props
                                y1Title: testDef.config.yAxisTitle,
                                y2Title: testDef.config.y2Title || null,
                                displayType: testDef.config.displayType || 'percent'
                            };
                            let templateId = testDef.graphType;

                            // Alias Mapping
                            if (templateId === 'grouped-bar-2' || templateId === 'grouped-bar-3') templateId = 'grouped-bar';
                            if (templateId === 'dual-metric-paired') templateId = 'dual-axis';
                            if (templateId === 'bar-gauge') templateId = 'single-bars-3';
                            // single-bar maps to single-bar. single-bars-3 maps to single-bars-3.

                            const template = graphTemplates[templateId];
                            console.log(`DEBUG: Custom Graph Render. ID: ${customId}, Type: ${templateId}, TemplateFound: ${!!template}`);

                            if (template) {
                                let cData = {};
                                const d = sectionData; // Short alias

                                try {
                                    if (templateId === 'single-bar') {
                                        // single-bar uses leftVal/rightVal
                                        cData = { leftVal: d.left || 0, rightVal: d.right || 0 };
                                        if (d.asymmetryPercent !== undefined) {
                                            updateAsymmetryDisplay(d.left, d.right, referenceSide, `asymmetry_custom_${customId}${index}`);
                                        }
                                    }
                                    else if (templateId === 'paired-bar') {
                                        // paired-bar template expects leftVal1/rightVal1
                                        cData = { leftVal1: d.left || 0, rightVal1: d.right || 0 };
                                        if (d.asymmetryPercent !== undefined) {
                                            updateAsymmetryDisplay(d.left, d.right, referenceSide, `asymmetry_custom_${customId}${index}`);
                                        }
                                    }
                                    else if (templateId === 'single-bars-3') {
                                        cData = { values: [d.val1 || 0, d.val2 || 0, d.val3 || 0] };
                                    }
                                    else if (templateId === 'dual-axis') {
                                        cData = {
                                            leftVal1: d.val1_L || 0, rightVal1: d.val1_R || 0,
                                            leftVal2: d.val2_L || 0, rightVal2: d.val2_R || 0
                                        };
                                        // Symmetry on Metric 1 (Bars)
                                        if (d.asymmetryPercent !== undefined) {
                                            updateAsymmetryDisplay(d.val1_L, d.val1_R, referenceSide, `asymmetry_custom_${customId}${index}`);
                                        }
                                    }
                                    else if (templateId === 'grouped-bar') {
                                        // 3 Groups
                                        const rawLabels = testDef.config.inputLabels || [];
                                        const safeLabels = rawLabels.length > 0
                                            ? rawLabels.map((l, i) => l || `Värde ${i + 1}`)
                                            : ['1', '2', '3'];

                                        cData = {
                                            labels: safeLabels,
                                            vaValues: [d.g1_L || 0, d.g2_L || 0, d.g3_L || 0],
                                            hoValues: [d.g1_R || 0, d.g2_R || 0, d.g3_R || 0]
                                        };
                                        // Symmetry on Average of 3 Attempts
                                        const avgL = (d.g1_L + d.g2_L + d.g3_L) / 3;
                                        const avgR = (d.g1_R + d.g2_R + d.g3_R) / 3;
                                        if (avgL > 0 && avgR > 0) {
                                            updateAsymmetryDisplay(avgL, avgR, referenceSide, `asymmetry_custom_${customId}${index}`);
                                        }
                                    }
                                    else if (templateId === 'three-bar') {
                                        cData = { leftVal: d.val_L || 0, rightVal: d.val_R || 0, bothVal: d.val_Both || 0 };

                                        // Animal Overlay for Three Bar (uses "Två ben" value like Static Squat)
                                        const bothKg = d.val_Both || 0;
                                        if (bothKg > 0) {
                                            const ovImg = document.getElementById(`overlay-image-custom_${customId}${index}`);
                                            const ovTxt = document.getElementById(`overlay-text-custom_${customId}${index}`);
                                            if (ovImg && ovTxt) {
                                                updateAnimalOverlay(bothKg, ovImg, ovTxt);
                                            }
                                        }

                                        // Asymmetry display for left/right
                                        if (d.asymmetryPercent !== undefined) {
                                            updateAsymmetryDisplay(d.val_L, d.val_R, referenceSide, `asymmetry_custom_${customId}${index}`);
                                        }
                                    }
                                    else if (templateId === 'bilateral') {
                                        cData = { val1: d.val1 || 0, val2: d.val2 || 0 };
                                    }
                                    else if (templateId === 'donut') {
                                        // Donut template has 3 separate divs, render each separately
                                        const template = graphTemplates[templateId];
                                        const values = [d.val1 || 0, d.val2 || 0, d.val3 || 0];
                                        values.forEach((val, i) => {
                                            const donutChartId = `custom-chart-donut-${i + 1}-${customId}${index}`;
                                            const fig = template.create({ value: val }, config);
                                            Plotly.react(donutChartId, fig.data, fig.layout, plotlyConfig);
                                        });
                                        return; // Skip the main render below
                                    }
                                    else if (templateId === 'bar-gauge') {
                                        cData = { values: [d.val1 || 0, d.val2 || 0, d.val3 || 0] };
                                        config.labels = testDef.config.inputLabels;
                                    }
                                    else if (templateId === 'manual') {
                                        // Manual type has no graph, only text inputs
                                        // Hide the graph container
                                        container.style.display = 'none';
                                        return; // Skip graph rendering
                                    }

                                    const fig = template.create(cData, config);
                                    Plotly.react(chartId, fig.data, fig.layout, plotlyConfig);

                                } catch (err) {
                                    console.error(`Error rendering custom chart ${customId}:`, err);
                                    container.innerHTML = `<p style="color:red; font-size: 12px;">Graph Error: ${err.message}</p>`;
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (data.page2.manual) {
        updateManualPreview(data.page2.manual);
    }
}

function exportToExcel() {
    const data = collectDataFromForm();
    const flatData = [
        { Test: 'Namn', Verdi: data.patientInfo.name },
        { Test: 'Datum', Verdi: data.patientInfo.date },
        { Test: 'Sport/Position', Verdi: data.patientInfo.sportPosition },
        { Test: 'Skapad Av', Verdi: data.patientInfo.createdBy },
        { Test: 'Referenstyp', Verdi: data.patientInfo.dominantSideType },
        { Test: 'Referenssida', Verdi: data.patientInfo.dominantSide },
    ];

    if (data.page1.balance) {
        flatData.push(
            { Test: 'Balans - VÄ Score', Verdi: data.page1.balance.leftScore },
            { Test: 'Balans - HÖ Score', Verdi: data.page1.balance.rightScore },
            { Test: 'Balans - VÄ Gen. diff', Verdi: data.page1.balance.leftDiff },
            { Test: 'Balans - HÖ Gen. diff', Verdi: data.page1.balance.rightDiff },
            { Test: 'Balans - Kommentar', Verdi: data.page1.balance.comment },
            { Test: 'Balans - Asymmetri %', Verdi: data.page1.balance.asymmetryPercent }
        );
    }

    if (data.page1.cmj) {
        flatData.push(
            { Test: 'CMJ - VÄ Hopp 1', Verdi: data.page1.cmj.vaJumps[0] },
            { Test: 'CMJ - VÄ Hopp 2', Verdi: data.page1.cmj.vaJumps[1] },
            { Test: 'CMJ - VÄ Hopp 3', Verdi: data.page1.cmj.vaJumps[2] },
            { Test: 'CMJ - HÖ Hopp 1', Verdi: data.page1.cmj.hoJumps[0] },
            { Test: 'CMJ - HÖ Hopp 2', Verdi: data.page1.cmj.hoJumps[1] },
            { Test: 'CMJ - HÖ Hopp 3', Verdi: data.page1.cmj.hoJumps[2] },
            { Test: 'CMJ - Kommentar', Verdi: data.page1.cmj.comment },
            { Test: 'CMJ - Asymmetri %', Verdi: data.page1.cmj.asymmetryPercent }
        );
    }

    if (data.page1.tia) {
        flatData.push(
            { Test: 'TIA - VÄ Hopphöjd', Verdi: data.page1.tia.leftJump },
            { Test: 'TIA - HÖ Hopphöjd', Verdi: data.page1.tia.rightJump },
            { Test: 'TIA - VÄ GCT', Verdi: data.page1.tia.leftGct },
            { Test: 'TIA - HÖ GCT', Verdi: data.page1.tia.rightGct },
            { Test: 'TIA - Kommentar', Verdi: data.page1.tia.comment },
            { Test: 'TIA - Asymmetri %', Verdi: data.page1.tia.asymmetryPercent }
        );
    }

    if (data.page1.sidehop) {
        flatData.push(
            { Test: 'Sidhopp - VÄ Antal', Verdi: data.page1.sidehop.leftCount },
            { Test: 'Sidhopp - HÖ Antal', Verdi: data.page1.sidehop.rightCount },
            { Test: 'Sidhopp - Kommentar', Verdi: data.page1.sidehop.comment },
            { Test: 'Sidhopp - Asymmetri %', Verdi: data.page1.sidehop.asymmetryPercent }
        );
    }

    if (data.page1.squatAnalytics) {
        flatData.push(
            { Test: 'Squat Analytics - Försök 1', Verdi: data.page1.squatAnalytics.attempt1 },
            { Test: 'Squat Analytics - Försök 2', Verdi: data.page1.squatAnalytics.attempt2 },
            { Test: 'Squat Analytics - Försök 3', Verdi: data.page1.squatAnalytics.attempt3 },
            { Test: 'Squat Analytics - Kommentar', Verdi: data.page1.squatAnalytics.comment }
        );
    }

    if (data.page1.repeatedBilateral) {
        flatData.push(
            { Test: 'Repeated Bilateral - Gen. Hopphöjd', Verdi: data.page1.repeatedBilateral.avgHeight },
            { Test: 'Repeated Bilateral - Gen. GCT', Verdi: data.page1.repeatedBilateral.avgGct },
            { Test: 'Repeated Bilateral - Kommentar', Verdi: data.page1.repeatedBilateral.comment }
        );
    }

    if (data.page1.cmj2ben) {
        flatData.push(
            { Test: 'CMJ Två Ben - Försök 1', Verdi: data.page1.cmj2ben.attempt1 },
            { Test: 'CMJ Två Ben - Försök 2', Verdi: data.page1.cmj2ben.attempt2 },
            { Test: 'CMJ Två Ben - Försök 3', Verdi: data.page1.cmj2ben.attempt3 },
            { Test: 'CMJ Två Ben - Kommentar', Verdi: data.page1.cmj2ben.comment }
        );
    }

    if (data.page2.strengthTests.hipThrust) {
        flatData.push(
            { Test: 'Styrka - Hip Thrust VÄ', Verdi: data.page2.strengthTests.hipThrust.left },
            { Test: 'Styrka - Hip Thrust HÖ', Verdi: data.page2.strengthTests.hipThrust.right },
            { Test: 'Styrka - Hip Thrust Två ben', Verdi: data.page2.strengthTests.hipThrust.tva },
            { Test: 'Styrka - Hip Thrust Kommentar', Verdi: data.page2.strengthTests.hipThrust.comment },
            { Test: 'Styrka - Hip Thrust Asymmetri %', Verdi: data.page2.strengthTests.hipThrust.asymmetryPercent }
        );
    }

    if (data.page2.strengthTests.quadriceps) {
        flatData.push(
            { Test: 'Styrka - Quadriceps VÄ', Verdi: data.page2.strengthTests.quadriceps.left },
            { Test: 'Styrka - Quadriceps HÖ', Verdi: data.page2.strengthTests.quadriceps.right },
            { Test: 'Styrka - Quadriceps Kommentar', Verdi: data.page2.strengthTests.quadriceps.comment },
            { Test: 'Styrka - Quadriceps Asymmetri %', Verdi: data.page2.strengthTests.quadriceps.asymmetryPercent }
        );
    }

    if (data.page2.strengthTests.staticsquatHanddrag) {
        flatData.push(
            { Test: 'Styrka - Squat Handdrag VÄ', Verdi: data.page2.strengthTests.staticsquatHanddrag.left },
            { Test: 'Styrka - Squat Handdrag HÖ', Verdi: data.page2.strengthTests.staticsquatHanddrag.right },
            { Test: 'Styrka - Squat Handdrag Två ben', Verdi: data.page2.strengthTests.staticsquatHanddrag.both },
            { Test: 'Styrka - Squat Handdrag Kommentar', Verdi: data.page2.strengthTests.staticsquatHanddrag.comment },
            { Test: 'Styrka - Squat Handdrag Asymmetri %', Verdi: data.page2.strengthTests.staticsquatHanddrag.asymmetryPercent }
        );
    }

    if (data.page2.strengthTests.staticsquatHoftrem) {
        flatData.push(
            { Test: 'Styrka - Squat Höftrem VÄ', Verdi: data.page2.strengthTests.staticsquatHoftrem.left },
            { Test: 'Styrka - Squat Höftrem HÖ', Verdi: data.page2.strengthTests.staticsquatHoftrem.right },
            { Test: 'Styrka - Squat Höftrem Två ben', Verdi: data.page2.strengthTests.staticsquatHoftrem.both },
            { Test: 'Styrka - Squat Höftrem Kommentar', Verdi: data.page2.strengthTests.staticsquatHoftrem.comment },
            { Test: 'Styrka - Squat Höftrem Asymmetri %', Verdi: data.page2.strengthTests.staticsquatHoftrem.asymmetryPercent }
        );
    }

    if (data.page2.strengthTests.hamstring) {
        flatData.push(
            { Test: 'Styrka - Hamstring VÄ', Verdi: data.page2.strengthTests.hamstring.left },
            { Test: 'Styrka - Hamstring HÖ', Verdi: data.page2.strengthTests.hamstring.right },
            { Test: 'Styrka - Hamstring Kommentar', Verdi: data.page2.strengthTests.hamstring.comment },
            { Test: 'Styrka - Hamstring Asymmetri %', Verdi: data.page2.strengthTests.hamstring.asymmetryPercent }
        );
    }

    if (data.page2.strengthTests.nordicHamstring) {
        flatData.push(
            { Test: 'Styrka - Nordic Hamstring Försök 1', Verdi: data.page2.strengthTests.nordicHamstring.attempt1 },
            { Test: 'Styrka - Nordic Hamstring Försök 2', Verdi: data.page2.strengthTests.nordicHamstring.attempt2 },
            { Test: 'Styrka - Nordic Hamstring Försök 3', Verdi: data.page2.strengthTests.nordicHamstring.attempt3 },
            { Test: 'Styrka - Nordic Hamstring Kommentar', Verdi: data.page2.strengthTests.nordicHamstring.comment }
        );
    }

    if (data.page2.manual) {
        flatData.push(
            { Test: 'Manuell - SRP Tare', Verdi: data.page2.manual.srp.tare },
            { Test: 'Manuell - SRP Force', Verdi: data.page2.manual.srp.force },
            { Test: 'Manuell - SPTS kg', Verdi: data.page2.manual.spts.kg },
            { Test: 'Manuell - MPU Tare', Verdi: data.page2.manual.mpu.tare },
            { Test: 'Manuell - MPU Force', Verdi: data.page2.manual.mpu.force },
            { Test: 'Manuell - BPC Hits', Verdi: data.page2.manual.bpc.hits }
        );
    }

    const worksheet = XLSX.utils.json_to_sheet(flatData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Testdata");
    XLSX.writeFile(workbook, `Fysiosport_Data_${data.patientInfo.name || 'patient'}_${data.patientInfo.date || ''}.xlsx`);
}

function setDefaultComments() {
    document.getElementById('comment_balance').value = 'Visar balanspoäng och genomsnittlig avvikelse i cm.';
    document.getElementById('comment_cmj').value = 'Visar hopphöjd i centimeter (cm) för tre separata hopp.';
    document.getElementById('comment_tia').value = 'Visar genomsnittlig hopphöjd (cm) och markkontakttid (sekunder).';
    document.getElementById('comment_sidehop').value = 'Visar antal sidhopp utförda inom tidsramen.';
    document.getElementById('comment_squat').value = 'Visar poäng för tre separata knäböjsförsök.';
    document.getElementById('comment_repeated_bilateral').value = 'Visar genomsnittlig hopphöjd och markkontakttid för hopp på två ben.';
    document.getElementById('comment_cmj2ben').value = 'Visar poäng för tre separata CMJ-hopp på två ben.';
    const defaultStrengthComment = 'Visar kraftutveckling för vänster (VÄ) och höger (HÖ) sida.';
    document.getElementById('comment_hipthrust').value = defaultStrengthComment;
    document.getElementById('comment_quads').value = defaultStrengthComment;
    document.getElementById('comment_squat_pull_handdrag').value = defaultStrengthComment;
    document.getElementById('comment_squat_pull_hoftrem').value = defaultStrengthComment;
    document.getElementById('comment_hamstring').value = defaultStrengthComment;
    document.getElementById('comment_nordic_hamstring').value = 'Visar poäng för tre separata Nordic Hamstring-försök.';
}

// --- EVENT LISTENERS & INITIALIZATION ---
// Global listeners moved to DOMContentLoaded


function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);

        const structuredData = {
            patientInfo: {},
            page1: {
                balance: {},
                cmj: { vaJumps: [], hoJumps: [] },
                tia: {},
                sidehop: {},
                squatAnalytics: {},
                repeatedBilateral: {},
                cmj2ben: {}
            },
            page2: {
                strengthTests: {
                    hipThrust: {},
                    quadriceps: {},
                    staticsquatHanddrag: {},
                    staticsquatHoftrem: {},
                    hamstring: {},
                    nordicHamstring: {}
                },
                manual: {
                    srp: {},
                    spts: {},
                    mpu: {},
                    bpc: {}
                }
            }
        };

        json.forEach(row => {
            const key = row.Test;
            const value = row.Verdi;
            switch (key) {
                case 'Namn': structuredData.patientInfo.name = value; break;
                case 'Datum': structuredData.patientInfo.date = value; break;
                case 'Sport/Position': structuredData.patientInfo.sportPosition = value; break;
                case 'Skapad Av': structuredData.patientInfo.createdBy = value; break;
                case 'Referenstyp': structuredData.patientInfo.dominantSideType = value; break;
                case 'Referenssida': structuredData.patientInfo.dominantSide = value; break;
                case 'Balans - VÄ Score': structuredData.page1.balance.leftScore = value; break;
                case 'Balans - HÖ Score': structuredData.page1.balance.rightScore = value; break;
                case 'Balans - VÄ Gen. diff': structuredData.page1.balance.leftDiff = value; break;
                case 'Balans - HÖ Gen. diff': structuredData.page1.balance.rightDiff = value; break;
                case 'Balans - Kommentar': structuredData.page1.balance.comment = value; break;
                case 'CMJ - VÄ Hopp 1': structuredData.page1.cmj.vaJumps[0] = value; break;
                case 'CMJ - VÄ Hopp 2': structuredData.page1.cmj.vaJumps[1] = value; break;
                case 'CMJ - VÄ Hopp 3': structuredData.page1.cmj.vaJumps[2] = value; break;
                case 'CMJ - HÖ Hopp 1': structuredData.page1.cmj.hoJumps[0] = value; break;
                case 'CMJ - HÖ Hopp 2': structuredData.page1.cmj.hoJumps[1] = value; break;
                case 'CMJ - HÖ Hopp 3': structuredData.page1.cmj.hoJumps[2] = value; break;
                case 'CMJ - Kommentar': structuredData.page1.cmj.comment = value; break;
                case 'TIA - VÄ Hopphöjd': structuredData.page1.tia.leftJump = value; break;
                case 'TIA - HÖ Hopphöjd': structuredData.page1.tia.rightJump = value; break;
                case 'TIA - VÄ GCT': structuredData.page1.tia.leftGct = value; break;
                case 'TIA - HÖ GCT': structuredData.page1.tia.rightGct = value; break;
                case 'TIA - Kommentar': structuredData.page1.tia.comment = value; break;
                case 'Sidhopp - VÄ Antal': structuredData.page1.sidehop.leftCount = value; break;
                case 'Sidhopp - HÖ Antal': structuredData.page1.sidehop.rightCount = value; break;
                case 'Sidhopp - Kommentar': structuredData.page1.sidehop.comment = value; break;
                case 'Squat Analytics - Försök 1': structuredData.page1.squatAnalytics.attempt1 = value; break;
                case 'Squat Analytics - Försök 2': structuredData.page1.squatAnalytics.attempt2 = value; break;
                case 'Squat Analytics - Försök 3': structuredData.page1.squatAnalytics.attempt3 = value; break;
                case 'Squat Analytics - Kommentar': structuredData.page1.squatAnalytics.comment = value; break;
                case 'Repeated Bilateral - Gen. Hopphöjd': structuredData.page1.repeatedBilateral.avgHeight = value; break;
                case 'Repeated Bilateral - Gen. GCT': structuredData.page1.repeatedBilateral.avgGct = value; break;
                case 'Repeated Bilateral - Kommentar': structuredData.page1.repeatedBilateral.comment = value; break;
                case 'CMJ Två Ben - Försök 1': structuredData.page1.cmj2ben.attempt1 = value; break;
                case 'CMJ Två Ben - Försök 2': structuredData.page1.cmj2ben.attempt2 = value; break;
                case 'CMJ Två Ben - Försök 3': structuredData.page1.cmj2ben.attempt3 = value; break;
                case 'CMJ Två Ben - Kommentar': structuredData.page1.cmj2ben.comment = value; break;
                case 'Styrka - Hip Thrust VÄ': structuredData.page2.strengthTests.hipThrust.left = value; break;
                case 'Styrka - Hip Thrust HÖ': structuredData.page2.strengthTests.hipThrust.right = value; break;
                case 'Styrka - Hip Thrust Två ben': structuredData.page2.strengthTests.hipThrust.tva = value; break;
                case 'Styrka - Hip Thrust Kommentar': structuredData.page2.strengthTests.hipThrust.comment = value; break;
                case 'Styrka - Hip Thrust Asymmetri %': structuredData.page2.strengthTests.hipThrust.asymmetryPercent = value; break;
                case 'Styrka - Quadriceps VÄ': structuredData.page2.strengthTests.quadriceps.left = value; break;
                case 'Styrka - Quadriceps HÖ': structuredData.page2.strengthTests.quadriceps.right = value; break;
                case 'Styrka - Quadriceps Kommentar': structuredData.page2.strengthTests.quadriceps.comment = value; break;
                case 'Styrka - Squat Handdrag VÄ': structuredData.page2.strengthTests.staticsquatHanddrag.left = value; break;
                case 'Styrka - Squat Handdrag HÖ': structuredData.page2.strengthTests.staticsquatHanddrag.right = value; break;
                case 'Styrka - Squat Handdrag Två ben': structuredData.page2.strengthTests.staticsquatHanddrag.both = value; break;
                case 'Styrka - Squat Handdrag Kommentar': structuredData.page2.strengthTests.staticsquatHanddrag.comment = value; break;
                case 'Styrka - Squat Höftrem VÄ': structuredData.page2.strengthTests.staticsquatHoftrem.left = value; break;
                case 'Styrka - Squat Höftrem HÖ': structuredData.page2.strengthTests.staticsquatHoftrem.right = value; break;
                case 'Styrka - Squat Höftrem Två ben': structuredData.page2.strengthTests.staticsquatHoftrem.both = value; break;
                case 'Styrka - Squat Höftrem Kommentar': structuredData.page2.strengthTests.staticsquatHoftrem.comment = value; break;
                case 'Styrka - Hamstring VÄ': structuredData.page2.strengthTests.hamstring.left = value; break;
                case 'Styrka - Hamstring HÖ': structuredData.page2.strengthTests.hamstring.right = value; break;
                case 'Styrka - Hamstring Kommentar': structuredData.page2.strengthTests.hamstring.comment = value; break;
                case 'Styrka - Nordic Hamstring Försök 1': structuredData.page2.strengthTests.nordicHamstring.attempt1 = value; break;
                case 'Styrka - Nordic Hamstring Försök 2': structuredData.page2.strengthTests.nordicHamstring.attempt2 = value; break;
                case 'Styrka - Nordic Hamstring Försök 3': structuredData.page2.strengthTests.nordicHamstring.attempt3 = value; break;
                case 'Styrka - Nordic Hamstring Kommentar': structuredData.page2.strengthTests.nordicHamstring.comment = value; break;
                case 'Manuell - SRP Tare': structuredData.page2.manual.srp.tare = value; break;
                case 'Manuell - SRP Force': structuredData.page2.manual.srp.force = value; break;
                case 'Manuell - SPTS kg': structuredData.page2.manual.spts.kg = value; break;
                case 'Manuell - MPU Tare': structuredData.page2.manual.mpu.tare = value; break;
                case 'Manuell - MPU Force': structuredData.page2.manual.mpu.force = value; break;
                case 'Manuell - BPC Hits': structuredData.page2.manual.bpc.hits = value; break;
            }
        });

        populateFormFromData(structuredData);
        document.querySelectorAll('.test-section').forEach(section => {
            section.style.display = 'block';
        });
        alert('Data importerad!');
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
}

document.querySelectorAll('#input-form input, #input-form textarea, #input-form input[type="radio"]').forEach(input => {
    input.addEventListener('input', debounce(() => {
        updatePreview();
        // saveData(); // REMOVED: Auto-save disabled per user request
    }, 1000));
});

document.querySelectorAll('textarea[id^="comment_"]').forEach(textarea => {
    textarea.addEventListener('focus', () => {
        textarea.dataset.isDefault = 'false';
    });
});

// --- Test Selection Logic ---
// --- Test Selection Logic ---
// --- Test Selection Logic ---
function renderTestSelection(activeTestIds = null) {
    const inputContainer = document.getElementById('test-input-container');
    const buttonContainer = document.getElementById('test-list');

    if (inputContainer) inputContainer.innerHTML = '';
    if (buttonContainer) buttonContainer.innerHTML = '';

    // Determine what to render
    let testsToRender = [];
    if (activeTestIds) {
        console.log("renderTestSelection Called with IDs:", activeTestIds);
        testsToRender = activeTestIds;
    } else {
        console.log("renderTestSelection Called with NULL, using default");
        // Default: One of each available test
        if (window.allTests) {
            testsToRender = window.allTests.map(t => t.id);
        } else {
            console.error("Critical: window.allTests is undefined!");
            testsToRender = [];
        }
    }

    const counts = {};
    const totalCounts = {};
    testsToRender.forEach(id => totalCounts[id] = (totalCounts[id] || 0) + 1);

    testsToRender.forEach((testId, i) => {
        counts[testId] = (counts[testId] || 0) + 1;

        let template = testTemplates[testId];

        if (!template) {
            // Fix: Strip 'custom_' prefix if present when searching in allTests
            // allTests IDs are raw Firestore IDs (e.g. 'abc'). testId here is 'custom_abc'.
            const rawId = testId.startsWith('custom_') ? testId.replace('custom_', '') : testId;
            const testDef = window.allTests ? window.allTests.find(t => t.id === rawId) : null;

            if (testDef && (testDef.isCustom || testDef.type === 'custom')) {
                // Ensure generateTemplate is imported or available! 
                // It is imported as 'generateTemplate'.
                console.log(`DEBUG: Generating template for custom test. ID: ${rawId}, Name: ${testDef.name}, GraphType: ${testDef.graphType}`);
                template = generateTemplate(testDef);
                console.log(`DEBUG: Generated template length: ${template ? template.length : 'NULL'}`);
            }
        }

        if (!template) {
            console.warn(`Template not found for test: ${testId}`);
            return;
        }

        const label = totalCounts[testId] > 1 ? ` #${counts[testId]}` : '';
        const suffix = `_${i}`; // Unique suffix based on position in list

        // Replace placeholders
        const html = template
            .replace(/{{INDEX}}/g, suffix)
            .replace(/{{INDEX_LABEL}}/g, label);

        // Debug: Log first 500 chars of HTML for custom tests
        if (testId.startsWith('custom_')) {
            console.log(`DEBUG: Inserting HTML for ${testId}. First 500 chars:`, html.substring(0, 500));
        }

        inputContainer.insertAdjacentHTML('beforeend', html);
    });

    // Re-attach listeners for graph updates
    if (inputContainer) {
        inputContainer.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('input', () => {
                updatePreview();
                // Debounced save could go here
            });
        });
    }

    // Immediately update preview to render empty graphs
    updatePreview();
}



// Event listener removed as it was duplicate of individual button onclick handlers above

// Imports moved to top

// Ensure global functions from utils are available if needed (utils.js should be imported as module too)
// Note: Since index.js is now a module, global functions like 'saveData' won't be exposed to window automatically unless we do it explicitly.
// However, the event listeners are attached in JS, so it should be fine.

// Helper to remove undefined values for Firestore
function sanitizeData(obj) {
    if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach(key => {
            if (obj[key] === undefined) {
                delete obj[key];
            } else if (typeof obj[key] === 'object') {
                sanitizeData(obj[key]);
                // Optional: remove empty objects? 
                // data.page1 might become {} if no tests selected. Firestore handles {} fine.
            }
        });
    }
    return obj;
}

// --- LOGIC: SAVE / LOAD DATA ---
async function saveData() {
    if (!auth.currentUser) return;
    if (!currentPatient) {
        console.warn("Cannot save: No patient selected.");
        alert("Du måste välja en patient först.");
        return;
    }

    // 1. Collect all data from the form
    let data = collectDataFromForm();

    // 2. Add Metadata
    data.userId = auth.currentUser.uid;
    data.updatedAt = serverTimestamp(); // Always update timestamp
    if (!data.createdAt) {
        // This might be overwritten if we load existing, handle in populate
    }

    data.patientId = currentPatient.id;
    data.patientInternalId = currentPatient.internalId; // redundant but useful
    data.patientName = `${currentPatient.firstName} ${currentPatient.lastName}`;

    // 3. Sanitize Data (Remove undefined)
    data = sanitizeData(data);

    // 4. Save to Firestore
    try {
        const screeningsRef = collection(db, `users/${auth.currentUser.uid}/patients/${currentPatient.id}/screenings`);

        if (currentScreeningId) {
            // Update existing
            await setDoc(doc(screeningsRef, currentScreeningId), data, { merge: true });
            console.log("Assessment updated:", currentScreeningId);
        } else {
            // Create new
            data.createdAt = serverTimestamp();
            data.testDate = new Date().toISOString().split('T')[0]; // Default date
            const docRef = await addDoc(screeningsRef, data);
            currentScreeningId = docRef.id;
            console.log("New Assessment created:", currentScreeningId);
        }

        // Refresh history list
        loadPatientHistory(currentPatient.id);

        // Show feedback
        alert('Data sparad!');

    } catch (e) {
        console.error("Error saving assessment: ", e);
        alert("Ett fel uppstod vid sparning: " + e.message);
    }
}

window.saveData = saveData;

// --- PATIENT UI & LOGIC IMPLEMENTATION ---

async function openNewPatientModal(existingPatient = null) {
    const modalContent = document.getElementById('patient-modal-content');
    // Ensure it's a real object with an ID, not a DOM Event or random object
    const isEdit = !!(existingPatient && existingPatient.id);
    const title = isEdit ? 'Redigera Patient' : 'Ny Patient';
    const btnText = isEdit ? 'Spara Ändringar' : 'Skapa Patient';

    modalContent.innerHTML = `
        <h3>${title}</h3>
        <div id="new-patient-form-container">
            <div class="modal-form-grid">
                <div class="modal-form-item"><label>Förnamn</label><input id="p-firstname" value="${existingPatient?.firstName || ''}"></div>
                <div class="modal-form-item"><label>Efternamn</label><input id="p-lastname" value="${existingPatient?.lastName || ''}"></div>
                <div class="modal-form-item"><label>Patient ID (Internt)</label><input id="p-internal-id" value="${existingPatient?.internalId || ''}"></div>
                <div class="modal-form-item"><label>Födelsedatum</label><input id="p-dob" type="date" value="${existingPatient?.dob || ''}"></div>
                 <div class="modal-form-item"><label>Kön</label>
                    <select id="p-gender">
                        <option value="Man">Man</option>
                        <option value="Kvinna">Kvinna</option>
                        <option value="Annat">Annat</option>
                    </select>
                </div>
                <div class="modal-form-item"><label>Sport</label><input id="p-sport" value="${existingPatient?.sport || ''}"></div>
                <div class="modal-form-item"><label>Skada</label><input id="p-injury" value="${existingPatient?.injury || ''}"></div>
                <div class="modal-form-item"><label>Skadad Sida</label>
                    <select id="p-injured-side">
                        <option value="Höger">Höger</option>
                        <option value="Vänster">Vänster</option>
                        <option value="Ingen">Ingen</option>
                    </select>
                </div>
                 <div class="modal-form-item"><label>Kroppsvikt (kg)</label><input id="p-bodyweight" type="number" step="0.1" value="${existingPatient?.bodyweight || ''}"></div>
            </div>
            <div class="modal-actions">
                <button type="button" class="modal-cancel-button" id="cancel-new-patient">Avbryt</button>
                <button type="button" class="modal-confirm-button" id="btn-create-patient-action">${btnText}</button>
            </div>
        </div>
    `;

    // Set Select Defaults
    if (existingPatient) {
        if (existingPatient.gender) document.getElementById('p-gender').value = existingPatient.gender;
        if (existingPatient.injuredSide) document.getElementById('p-injured-side').value = existingPatient.injuredSide;
    }

    document.getElementById('patient-modal-overlay').style.display = 'flex';

    document.getElementById('cancel-new-patient').onclick = () => {
        document.getElementById('patient-modal-overlay').style.display = 'none';
    };

    // Direct Click Handler (Bypassing Form Submission)
    document.getElementById('btn-create-patient-action').onclick = async () => {
        const btn = document.getElementById('btn-create-patient-action');
        btn.disabled = true;
        btn.textContent = 'Sparar...';

        const patientData = {
            firstName: document.getElementById('p-firstname').value || 'Unknown',
            lastName: document.getElementById('p-lastname').value || 'Unknown',
            internalId: document.getElementById('p-internal-id').value || `Gen-${Date.now()}`,
            dob: document.getElementById('p-dob').value,
            age: document.getElementById('p-dob').value ? new Date().getFullYear() - new Date(document.getElementById('p-dob').value).getFullYear() : 0,
            gender: document.getElementById('p-gender').value,
            sport: document.getElementById('p-sport').value,
            injury: document.getElementById('p-injury').value,
            injuredSide: document.getElementById('p-injured-side').value,
            bodyweight: parseFloat(document.getElementById('p-bodyweight').value) || 0,
            updatedAt: serverTimestamp()
        };

        if (isEdit) {
            patientData.userId = existingPatient.userId; // Keep original owner
            // Update
            try {
                await updateDoc(doc(db, "users", auth.currentUser.uid, "patients", existingPatient.id), patientData);
                alert('Patient uppdaterad!');

                // Update local object and UI
                currentPatient = { ...currentPatient, ...patientData };
                renderPatientCard(currentPatient);
                document.getElementById('patient-modal-overlay').style.display = 'none';

            } catch (e) {
                console.error("Update failed", e);
                alert("Kunde inte uppdatera: " + e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = btnText;
            }
        } else {
            // Create New
            patientData.createdBy = auth.currentUser.uid;
            patientData.userId = auth.currentUser.uid;
            patientData.createdAt = serverTimestamp();
            await createNewPatient(patientData);
            btn.disabled = false;
            btn.textContent = btnText;
        }
    };
}

async function createNewPatient(data) {
    console.log("Attempting to create patient with data:", data);

    try {
        console.log("Step 1: Check/Create User Doc");
        // Ensure user document exists (required for some Security Rules)
        await setDoc(doc(db, "users", auth.currentUser.uid), {
            email: auth.currentUser.email,
            lastLogin: serverTimestamp()
        }, { merge: true });
        console.log("Step 1: Success.");
    } catch (e) {
        console.warn("Step 1 Failed (Non-fatal?):", e);
    }

    try {
        console.log("Step 2: Create Patient Doc");

        // Strict Data Sanitization
        const cleanData = {
            firstName: String(data.firstName || ''),
            lastName: String(data.lastName || ''),
            dob: String(data.dob || ''),
            age: Number(data.age) || 0,
            gender: String(data.gender || 'Annat'),
            sport: String(data.sport || ''),
            injury: String(data.injury || ''),
            injuredSide: String(data.injuredSide || 'Höger'),
            bodyweight: Number(data.bodyweight) || 0,
            internalId: String(data.internalId || ''),
            createdBy: String(auth.currentUser.uid),
            userId: String(auth.currentUser.uid),
            createdAt: serverTimestamp(),
            // Adding a simple string date as extra safety
            registeredDate: new Date().toISOString().split('T')[0]
        };

        const docRef = await addDoc(collection(db, "users", auth.currentUser.uid, "patients"), cleanData);
        console.log("Step 2: Success. ID:", docRef.id);

        cleanData.id = docRef.id;
        selectPatient(cleanData);
        document.getElementById('patient-modal-overlay').style.display = 'none';

        // Clear search input if open
        const searchInputModal = document.getElementById('patient-search-input-modal');
        const searchInputInline = document.getElementById('patient-search-input-inline');
        if (searchInputModal) searchInputModal.value = '';
        if (searchInputInline) searchInputInline.value = '';

        // Clear search lists
        const searchResultsModal = document.getElementById('search-results-list-modal');
        const searchResultsInline = document.getElementById('search-results-list-inline');
        if (searchResultsModal) searchResultsModal.innerHTML = '';
        if (searchResultsInline) searchResultsInline.innerHTML = '';

    } catch (e) {
        console.error("Error creating patient: ", e);
        alert(`Kunde inte skapa patient: ${e.message}`);
    }
}

async function searchPatients_OLD(term) {
    const list = document.getElementById('search-results-list');

    if (!list) return;

    list.innerHTML = 'Söker...';

    const q = query(collection(db, "users", auth.currentUser.uid, "patients"));
    try {
        const querySnapshot = await getDocs(q);
        list.innerHTML = '';
        const searchLower = term.toLowerCase();

        let found = 0;
        querySnapshot.forEach((doc) => {
            const p = doc.data();
            p.id = doc.id;
            const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
            const internalId = (p.internalId || '').toString().toLowerCase();

            if (fullName.includes(searchLower) || internalId.includes(searchLower)) {
                found++;
                const btn = document.createElement('button');
                btn.className = 'patient-search-result-item';

                btn.innerHTML = `
                    <strong>${p.firstName} ${p.lastName}</strong>
                    <span class="meta-info">ID: ${p.internalId || '-'}</span>
                `;
                btn.onclick = () => selectPatient(p);
                list.appendChild(btn);
            }
        });

        if (found === 0) list.innerHTML = '<div style="padding:10px; color:rgba(255,255,255,0.6);">Inga patienter hittades.</div>';
    } catch (e) {
        console.error("Error searching: ", e);
        list.innerHTML = '<div style="padding:10px; color:rgba(255,100,100,0.8);">Fel vid sökning (kontrollera konsol).</div>';
    }
}

// --- HELPER: RESET FORM STATE ---
function resetFormState() {
    // 1. Clear text/number inputs
    document.querySelectorAll('#input-form input[type="text"], #input-form input[type="number"], #input-form textarea').forEach(input => {
        input.value = '';
    });

    // 2. Reset Test Selections (Select All by Default)
    // First, unselect everything to be safe
    document.querySelectorAll('.test-selector-btn').forEach(btn => {
        btn.dataset.selected = 'false'; // Will be set to true immediately after for default behavior
    });
    // Then select all (default state) or let populateFormFromData handle it? 
    // "Default state" for a new patient often implies all tests available OR none. 
    // Based on previous code: renderTestSelection sets all to true.
    document.querySelectorAll('.test-selector-btn').forEach(btn => {
        btn.dataset.selected = 'true';
    });

    // 3. Show all sections
    document.querySelectorAll('.test-section').forEach(section => {
        section.style.display = 'block';
    });

    // 4. Reset Radio Buttons (e.g. Dominance)
    const domTypes = document.querySelectorAll('input[name="dominance_type"]');
    if (domTypes.length > 0) domTypes[0].checked = true; // Default to first

    // 5. Clear Manual Data Defaults if any (already handled by clearing inputs)

    // 6. Update Preview to clear it effectively
    updatePreview();
}

function selectPatient(patient) {
    console.log("selectPatient: Called with:", patient);
    if (!patient || !patient.id) {
        console.error("selectPatient: Missing patient ID!", patient);
        return;
    }

    // Optional: Check if already selected to avoid redundant loads, 
    // but user says it "doesn't work" so maybe we WANT a reload.
    // if (currentPatient && currentPatient.id === patient.id) return;

    currentPatient = patient;
    currentScreeningId = null; // New session/screening context

    // UI Updates
    const searchModal = document.getElementById('search-modal-overlay');
    if (searchModal) searchModal.style.display = 'none';

    // Hide search inline container if open
    const inlineContainer = document.getElementById('existing-patient-search-container');
    if (inlineContainer) inlineContainer.style.display = 'none';

    // NEW GRID LAYOUT: Show the main dashboard wrapper
    const dashboardWrapper = document.getElementById('active-patient-dashboard');
    if (dashboardWrapper) {
        dashboardWrapper.style.display = 'block';
        // Ensure form is visible (it should be block by default inside, but just in case)
        const formsSection = document.getElementById('main-content-forms');
        if (formsSection) formsSection.style.display = 'block';

        // Ensure protocol selector container is visible
        const testSelContainer = document.getElementById('test-selection-container');
        if (testSelContainer) testSelContainer.style.display = 'block';
    } else {
        // Fallback for safety/partial migrations
        console.warn('Dashboard wrapper not found, falling back to legacy display logic');
        const overviewSection = document.getElementById('patient-overview-section');
        if (overviewSection) overviewSection.style.display = 'flex';

        const formsSection = document.getElementById('main-content-forms');
        if (formsSection) formsSection.style.display = 'block';
    }

    // Update Card
    renderPatientCard(patient);

    // RESET FORM STATE COMPLETE
    resetFormState();

    // Form Pre-fill
    // Update personalia fields based on patient data
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('name', `${patient.firstName} ${patient.lastName}`);
    setVal('sport', patient.sport);
    setVal('date', new Date().toISOString().split('T')[0]);
    // For now keep default or logic if we added it to patient model.

    // Load History
    try {
        loadPatientHistory(patient.id);
    } catch (e) {
        console.error("selectPatient: Failed to load history", e);
    }

    // Force reload of protocols to ensure they are visible
    console.log("selectPatient: Reloading protocol selector...");
    loadAndRenderProtocolSelector();

    // SAVE STATE IMMEDIATELY so it persists on refresh
    saveDraft();
}

function renderPatientCard(patient) {
    const setTxt = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt || '-';
    };

    setTxt('card-patient-id', patient.internalId || patient.id);
    setTxt('card-patient-name', `${patient.firstName} ${patient.lastName}`);
    setTxt('card-patient-sport', patient.sport);
    setTxt('card-patient-dob', patient.dob);

    const injuredEl = document.getElementById('card-patient-injured-side');
    if (injuredEl) {
        injuredEl.textContent = patient.injuredSide || '-';
        injuredEl.dataset.side = patient.injuredSide || 'Ingen';
    }
}


async function loadPatientHistory(patientId) {
    const list = document.getElementById('selected-patient-tests-list');
    if (!list) return;

    list.innerHTML = '<li>Laddar historik...</li>';

    const q = query(
        collection(db, `users/${auth.currentUser.uid}/patients/${patientId}/screenings`),
        orderBy("updatedAt", "desc")
    );

    try {
        const snapshot = await getDocs(q);
        list.innerHTML = '';
        if (snapshot.empty) {
            list.innerHTML = '<li>Inga tester registrerade.</li>';
            return;
        }

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Fallback for date
            let dateDisplay = 'Okänt datum';
            if (data.testDate) dateDisplay = data.testDate;
            else if (data.updatedAt) dateDisplay = data.updatedAt.toDate().toLocaleDateString();

            const li = document.createElement('li');
            li.style.cursor = 'default'; // Cursor default because buttons are clickable
            li.style.padding = '10px';
            li.style.borderBottom = '1px solid rgba(0,0,0,0.05)';
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';

            li.innerHTML = `
                <span style="font-weight:500; font-size:0.95rem;">${dateDisplay}</span>
                <div class="history-btn-group">
                    <button class="btn-open">Öppna</button>
                    <button class="btn-delete" title="Radera">🗑</button>
                </div>
            `;

            // Attach event listeners safely
            const openBtn = li.querySelector('.btn-open');
            openBtn.onclick = (e) => {
                e.stopPropagation();
                loadAssessment(docSnap.id, data);
            };

            const deleteBtn = li.querySelector('.btn-delete');
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Är du säker på att du vill radera detta testtillfälle? Detta går inte att ångra.')) {
                    deleteScreening(patientId, docSnap.id);
                }
            };

            list.appendChild(li);
        });
    } catch (e) {
        console.error("History error: ", e);
        list.innerHTML = '<li>Kunde inte ladda historik.</li>';
    }
}

async function deleteScreening(patientId, screeningId) {
    try {
        await deleteDoc(doc(db, "users", auth.currentUser.uid, "patients", patientId, "screenings", screeningId));
        // Refresh list
        loadPatientHistory(patientId);
        // If current displayed screening is the one deleted, clear the form? 
        if (currentScreeningId === screeningId) {
            alert('Visat test raderades. Formuläret rensas.');
            // clear form logic or reload page
            // For now just notify
        }
    } catch (e) {
        console.error("Error deleting screening: ", e);
        alert("Kunde inte radera testet: " + e.message);
    }
}

function loadAssessment(docId, data) {
    currentScreeningId = docId;
    populateFormFromData(data);

    // Feedback
    // alert("Testdata laddad."); 
    // Scroll to form?
    document.getElementById('main-content-forms').scrollIntoView({ behavior: 'smooth' });
}


function updateManualPreview(manualData) {
    const previewContainer = document.getElementById('manual-preview-content');
    if (!previewContainer) return;

    // If manualData not provided (e.g. called from save), fetch it
    if (!manualData) {
        // We need collectDataFromForm but it's defined later or before?
        // It is defined in this file. It depends on hoisting.
        // But wait, if I put this BEFORE collectDataFromForm which is below...
        // Function declarations are hoisted. 
        // But to be safe let's assume manualData is passed or check.
        // Actually, updateManualPreview calls imply it expects data or fetches it.
        // In the legacy code it did: if (!manualData) { const d = collectDataFromForm(); manualData = d.page2.manual; }
        // Let's restore that logic.
        const d = collectDataFromForm();
        manualData = d.page2.manual;
    }

    const srpResult = (manualData.srp.force || 0) - (manualData.srp.tare || 0);
    const mpuResult = (manualData.mpu.force || 0) - (manualData.mpu.tare || 0);

    previewContainer.innerHTML = `
        <div class="manual-preview-box">
            <h4>Static Row Pull</h4>
            <p>Resultat</p>
            <b>${srpResult.toFixed(0)} N</b>
        </div>
        <div class="manual-preview-box">
            <h4>Squat Power to Speed</h4>
            <p>Vikt</p>
            <b>${manualData.spts.kg || 0} kg</b>
        </div>
        <div class="manual-preview-box">
            <h4>Max Press Push Up</h4>
            <p>Resultat</p>
            <b>${mpuResult.toFixed(0)} N</b>
        </div>
        <div class="manual-preview-box">
            <h4>Blaze Pod Challenge</h4>
            <p>Antal träffar</p>
            <b>${manualData.bpc.hits || 0} st</b>
        </div>
    `;
}


function collectDataFromForm() {
    const data = {
        patientInfo: {
            name: document.getElementById('card-patient-name')?.innerText || '',
            internalId: document.getElementById('card-patient-id')?.innerText || '',
            date: document.getElementById('date')?.value || '',
            sportPosition: document.getElementById('card-patient-sport')?.innerText || '',
            createdBy: document.getElementById('createdBy')?.value || '',
            dominantSideType: document.querySelector('input[name="dominance_type"]:checked')?.value,
            dominantSide: document.getElementById('card-patient-injured-side')?.dataset.side || 'Höger',
            injuredSide: document.getElementById('card-patient-injured-side')?.innerText || '',
        },
        page1: {},
        page1: {},
        page2: { strengthTests: {}, manual: {}, custom: {} },
        activeTestIds: [] // Save order for reconstruction
    };

    const sections = document.querySelectorAll('.test-section');
    const typeCounts = {};

    sections.forEach(sec => {
        const type = sec.dataset.testType;
        const index = sec.dataset.instanceIndex; // e.g. "_0"

        data.activeTestIds.push(type);

        // Count for key naming collision resolution
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        const isFirst = typeCounts[type] === 1;

        // Key mapping
        let key = type;
        if (type === 'repeated_bilateral') key = 'repeatedBilateral';
        if (type === 'cmj2ben') key = 'cmj2ben'; // same
        if (type === 'squat') key = 'squatAnalytics';

        // Page 2 mapping
        let p2key = type;
        if (type === 'hipthrust') p2key = 'hipThrust';
        if (type === 'quads') p2key = 'quadriceps';
        if (type === 'staticsquat-handdrag') p2key = 'staticsquatHanddrag';
        if (type === 'staticsquat-hoftrem') p2key = 'staticsquatHoftrem';
        if (type === 'nordic-hamstring') p2key = 'nordicHamstring';
        // hamstring remains hamstring

        // Determined Key Name
        let finalKey = key;
        if (!isFirst) finalKey += `_${typeCounts[type] - 1}`;
        let finalP2Key = p2key;
        if (!isFirst) finalP2Key += `_${typeCounts[type] - 1}`;

        // Helper
        const getNum = (baseId) => parseFloat(document.getElementById(`${baseId}${index}`)?.value) || 0;
        const getText = (baseId) => document.getElementById(`${baseId}${index}`)?.value || '';
        const getAsymmetry = (baseId) => {
            const el = document.getElementById(`${baseId}${index}`);
            return el ? parseFloat(el.dataset.asymmetryValue) || 0 : 0;
        };

        if (type === 'balance') {
            data.page1[finalKey] = {
                leftScore: getNum('p1_g1_va_score'), rightScore: getNum('p1_g1_ho_score'),
                leftDiff: getNum('p1_g1_va_diff'), rightDiff: getNum('p1_g1_ho_diff'),
                comment: getText('comment_balance'), asymmetryPercent: getAsymmetry('asymmetry_balance')
            };
        } else if (type === 'cmj') {
            data.page1[finalKey] = {
                vaJumps: [getNum('p1_g2_va_1'), getNum('p1_g2_va_2'), getNum('p1_g2_va_3')],
                hoJumps: [getNum('p1_g2_ho_1'), getNum('p1_g2_ho_2'), getNum('p1_g2_ho_3')],
                comment: getText('comment_cmj'), asymmetryPercent: getAsymmetry('asymmetry_cmj')
            };
        } else if (type === 'tia') {
            data.page1[finalKey] = {
                leftJump: getNum('p1_g3_va_jump'), rightJump: getNum('p1_g3_ho_jump'),
                leftGct: getNum('p1_g3_va_gct'), rightGct: getNum('p1_g3_ho_gct'),
                comment: getText('comment_tia'), asymmetryPercent: getAsymmetry('asymmetry_tia')
            };
        } else if (type === 'sidehop') {
            data.page1[finalKey] = {
                leftCount: getNum('p1_g4_va_count'), rightCount: getNum('p1_g4_ho_count'),
                comment: getText('comment_sidehop'), asymmetryPercent: getAsymmetry('asymmetry_sidehop')
            };
        } else if (type === 'squat') {
            data.page1[finalKey] = {
                attempt1: getNum('p1_g5_attempt_1'), attempt2: getNum('p1_g5_attempt_2'), attempt3: getNum('p1_g5_attempt_3'),
                comment: getText('comment_squat')
            };
        } else if (type === 'repeated_bilateral') {
            data.page1[finalKey] = {
                avgHeight: getNum('p1_g6_avg_height'), avgGct: getNum('p1_g6_avg_gct'),
                comment: getText('comment_repeated_bilateral')
            };
        } else if (type === 'cmj2ben') {
            data.page1[finalKey] = {
                attempt1: getNum('p1_g7_attempt_1'), attempt2: getNum('p1_g7_attempt_2'), attempt3: getNum('p1_g7_attempt_3'),
                comment: getText('comment_cmj2ben')
            };
        } else if (type === 'manual') {
            // Manual is page2.manual
            data.page2.manual[finalP2Key] = { // Wait, manual nesting.. 
                // If finalP2Key is 'manual' (first), it goes to data.page2.manual.
                // If 'manual_1', it goes to data.page2.manual_1? 
                // Original structure: page2: { manual: { srp: ... } }
                // New structure if multiple manuals:
                // page2: { manual: { srp... }, manual_1: { srp... } } is cleaner.
                // So we need to put it on data.page2 directly?
            };
            // Let's use flexible assignment
            if (isFirst) {
                data.page2.manual = {
                    srp: { tare: getNum('p2_text_srp_tare'), force: getNum('p2_text_srp_force') },
                    spts: { kg: getNum('p2_text_spts_kg') },
                    mpu: { tare: getNum('p2_text_mpu_tare'), force: getNum('p2_text_mpu_force') },
                    bpc: { hits: getNum('p2_text_bpc_hits') }
                };
            } else {
                data.page2[finalP2Key] = { // manual_1
                    srp: { tare: getNum('p2_text_srp_tare'), force: getNum('p2_text_srp_force') },
                    spts: { kg: getNum('p2_text_spts_kg') },
                    mpu: { tare: getNum('p2_text_mpu_tare'), force: getNum('p2_text_mpu_force') },
                    bpc: { hits: getNum('p2_text_bpc_hits') }
                };
            }
        } else if (type.startsWith('custom_')) {
            // Custom Tests data collection
            const customId = type.replace('custom_', '');

            // Look up definition for Graph Type
            // FIX: Use customId (stripped), not type (custom_ID)
            const testDef = window.allTests ? window.allTests.find(t => t.id === customId) : null;
            // Note: type is 'custom_ID'. allTests IDs are 'custom_ID'.

            let customData = { active: true };
            const baseKey = `custom_${customId}`;

            if (testDef) {
                // SAVE METADATA FOR REPORT.HTML
                customData.graphType = testDef.graphType;
                customData.title = testDef.name || testDef.title; // Fix: Use name if title is missing
                customData.config = testDef.config;

                const gType = testDef.graphType;

                if (gType === 'grouped-bar-3') {
                    customData.g1_L = getNum(`${baseKey}_g1_L`); customData.g1_R = getNum(`${baseKey}_g1_R`);
                    customData.g2_L = getNum(`${baseKey}_g2_L`); customData.g2_R = getNum(`${baseKey}_g2_R`);
                    customData.g3_L = getNum(`${baseKey}_g3_L`); customData.g3_R = getNum(`${baseKey}_g3_R`);
                    // Calc Asymmetry from Badge (updated by updatePreview)
                    customData.asymmetryPercent = getAsymmetry(`asymmetry_custom_${customId}`);
                } else if (gType === 'dual-axis') {
                    customData.val1_L = getNum(`${baseKey}_val1_L`); customData.val1_R = getNum(`${baseKey}_val1_R`);
                    customData.val2_L = getNum(`${baseKey}_val2_L`); customData.val2_R = getNum(`${baseKey}_val2_R`);
                    // Calc Asymmetry from Badge
                    customData.asymmetryPercent = getAsymmetry(`asymmetry_custom_${customId}`);
                } else if (gType === 'three-bar') {
                    customData.val_L = getNum(`${baseKey}_val_L`);
                    customData.val_R = getNum(`${baseKey}_val_R`);
                    customData.val_Both = getNum(`${baseKey}_val_Both`);
                    customData.asymmetryPercent = getAsymmetry(`asymmetry_custom_${customId}`);
                } else if (gType === 'donut' || gType === 'single-bars-3') {
                    customData.val1 = getNum(`${baseKey}_val1`);
                    customData.val2 = getNum(`${baseKey}_val2`);
                    customData.val3 = getNum(`${baseKey}_val3`);
                } else if (gType === 'manual') {
                    customData.manualValues = [];
                    const fields = testDef.config.metricNames || [];
                    fields.forEach((_, i) => {
                        customData.manualValues.push(getText(`${baseKey}_manual_${i + 1}`));
                    });
                } else if (gType === 'single-bar' || gType === 'paired-bar') {
                    // single-bar and paired-bar use left/right field naming
                    customData.left = getNum(`${baseKey}_left`);
                    customData.right = getNum(`${baseKey}_right`);
                    customData.asymmetryPercent = getAsymmetry(`asymmetry_custom_${customId}`);
                } else if (gType === 'bilateral') {
                    customData.val1 = getNum(`${baseKey}_val1`);
                    customData.val2 = getNum(`${baseKey}_val2`);
                } else {
                    // Default fallback
                    customData.val1 = getNum(`${baseKey}_val1`);
                }
            } else {
                // Fallback if def missing
                customData.val1 = getNum(`${baseKey}_val1`);
                customData.val2 = getNum(`${baseKey}_val2`);
                customData.title = customId; // Fallback title
                customData.graphType = 'unknown';
            }

            customData.comment = getText(`comment_${baseKey}`); // ID in template: comment_custom_ID{{INDEX}}
            customData.active = true; // CRITICAL: updatePreview() checks for .active flag!
            // Wait, template ID is `comment_custom_${id}{{INDEX}}`. 
            // In Loop: `baseKey` IS `custom_${customId}`.
            // But `getText` adds `index` suffix dynamically?
            // `getText` definition: `document.getElementById(`${id}${index}`)`. 
            // Yes.

            // Ensure path exists
            if (!data.page2.custom) data.page2.custom = {};
            data.page2.custom[customId] = customData;
        } else {
            // Strength Tests
            const stVal = {
                left: getNum(`p2_g${type === 'hipthrust' ? '1' : type === 'quads' ? '2' : type === 'staticsquat-handdrag' ? '3' : type === 'staticsquat-hoftrem' ? '4' : '5'}_va`),
                right: getNum(`p2_g${type === 'hipthrust' ? '1' : type === 'quads' ? '2' : type === 'staticsquat-handdrag' ? '3' : type === 'staticsquat-hoftrem' ? '4' : '5'}_ho`),
                active: true
            };
            if (type === 'hipthrust' || type.includes('squat')) stVal.tva = getNum(`p2_g${type === 'hipthrust' ? '1' : '3'}_tva`);

            if (type === 'hipthrust') {
                stVal.tva = getNum('p2_g1_tva');
                stVal.comment = getText('comment_hipthrust');
                stVal.asymmetryPercent = getAsymmetry('asymmetry_hipthrust');
            } else if (type === 'quads') {
                stVal.comment = getText('comment_quads');
                stVal.asymmetryPercent = getAsymmetry('asymmetry_quads');
            } else if (type === 'staticsquat-handdrag') {
                stVal.both = getNum('p2_g3_tva');
                stVal.comment = getText('comment_squat_pull_handdrag');
                stVal.asymmetryPercent = getAsymmetry('asymmetry_squat_pull_handdrag');
            } else if (type === 'staticsquat-hoftrem') {
                stVal.both = getNum('p2_g4_tva');
                stVal.comment = getText('comment_squat_pull_hoftrem');
                stVal.asymmetryPercent = getAsymmetry('asymmetry_squat_pull_hoftrem');
            } else if (type === 'hamstring') {
                stVal.comment = getText('comment_hamstring');
                stVal.asymmetryPercent = getAsymmetry('asymmetry_hamstring');
            }

            if (type === 'nordic-hamstring') {
                data.page2.strengthTests[finalP2Key] = {
                    attempt1: getNum('p2_g6_attempt_1'), attempt2: getNum('p2_g6_attempt_2'), attempt3: getNum('p2_g6_attempt_3'),
                    comment: getText('comment_nordic_hamstring')
                };
            } else {
                data.page2.strengthTests[finalP2Key] = stVal;
            }
        }
    });

    return data;
}

// ... (populateFormFromData function remains the same, I will assume it's defined above or below but since I'm replacing the end of file I should include it if it was there) ...
// Actually, I am replacing from "document.addEventListener" down in the previous file view, but let's make sure I don't lose the middle parts.
// I will check the file content again to be safe. I see I am replacing logically the persistence parts.

function populateFormFromData(data) {
    if (!data) return;

    // 1. Reconstruct Active Tests List
    let activeTestIds = [];
    if (data.activeTestIds && Array.isArray(data.activeTestIds)) {
        activeTestIds = data.activeTestIds;
    } else {
        // Legacy Data Reconstruction
        // Helper to map keys back to IDs
        const reverseMap = {
            repeatedBilateral: 'repeated_bilateral',
            cmj2ben: 'cmj2ben',
            squatAnalytics: 'squat',
            hipThrust: 'hipthrust',
            quadriceps: 'quads',
            staticsquatHanddrag: 'staticsquat-handdrag',
            staticsquatHoftrem: 'staticsquat-hoftrem',
            nordicHamstring: 'nordic-hamstring'
        };
        const getTestId = (k) => reverseMap[k] || k;

        if (data.page1) {
            Object.keys(data.page1).forEach(key => {
                let baseKey = key.replace(/_\d+$/, '');
                activeTestIds.push(getTestId(baseKey));
            });
        }
        if (data.page2) {
            if (data.page2.strengthTests) {
                Object.keys(data.page2.strengthTests).forEach(key => {
                    let baseKey = key.replace(/_\d+$/, '');
                    activeTestIds.push(getTestId(baseKey));
                });
            }
            if (data.page2.manual) {
                activeTestIds.push('manual');
            }
            // Check for extra manual keys if any (unlikely in legacy but possible)
            Object.keys(data.page2).forEach(key => {
                if (key !== 'strengthTests' && key !== 'manual') {
                    if (key.startsWith('manual')) activeTestIds.push('manual');
                }
            });
        }
    }

    // 2. Render UI
    renderTestSelection(activeTestIds);

    // 3. Populate Values
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val === 0 || val === '0') ? '' : val;
    };
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    // We iterate activeTestIds to track suffix counts
    const typeCounts = {};

    activeTestIds.forEach((testId, i) => {
        typeCounts[testId] = (typeCounts[testId] || 0) + 1;
        const indexSuffix = `_${i}`; // Match renderTestSelection logic
        const dataIndex = typeCounts[testId] - 1;

        let dataKeyBase = testId;
        if (testId === 'repeated_bilateral') dataKeyBase = 'repeatedBilateral';
        else if (testId === 'squat') dataKeyBase = 'squatAnalytics';
        else if (testId === 'hipthrust') dataKeyBase = 'hipThrust';
        else if (testId === 'quads') dataKeyBase = 'quadriceps';
        else if (testId === 'staticsquat-handdrag') dataKeyBase = 'staticsquatHanddrag';
        else if (testId === 'staticsquat-hoftrem') dataKeyBase = 'staticsquatHoftrem';
        else if (testId === 'nordic-hamstring') dataKeyBase = 'nordicHamstring';

        let dataKey = dataIndex === 0 ? dataKeyBase : `${dataKeyBase}_${dataIndex}`;

        let testData = null;
        if (data.page1 && data.page1[dataKey]) testData = data.page1[dataKey];
        else if (data.page2 && data.page2.strengthTests && data.page2.strengthTests[dataKey]) testData = data.page2.strengthTests[dataKey];
        else if (data.page2 && (dataKeyBase === 'manual')) {
            if (dataIndex === 0 && data.page2.manual) testData = data.page2.manual;
            else if (data.page2[dataKey]) testData = data.page2[dataKey];
        }

        if (!testData) return;

        const s = indexSuffix;

        if (testId === 'balance') {
            setVal(`p1_g1_va_score${s}`, testData.leftScore);
            setVal(`p1_g1_ho_score${s}`, testData.rightScore);
            setVal(`p1_g1_va_diff${s}`, testData.leftDiff);
            setVal(`p1_g1_ho_diff${s}`, testData.rightDiff);
            setText(`comment_balance${s}`, testData.comment);
        } else if (testId === 'cmj') {
            if (testData.vaJumps) {
                setVal(`p1_g2_va_1${s}`, testData.vaJumps[0]);
                setVal(`p1_g2_va_2${s}`, testData.vaJumps[1]);
                setVal(`p1_g2_va_3${s}`, testData.vaJumps[2]);
            }
            if (testData.hoJumps) {
                setVal(`p1_g2_ho_1${s}`, testData.hoJumps[0]);
                setVal(`p1_g2_ho_2${s}`, testData.hoJumps[1]);
                setVal(`p1_g2_ho_3${s}`, testData.hoJumps[2]);
            }
            setText(`comment_cmj${s}`, testData.comment);
        } else if (testId === 'tia') {
            setVal(`p1_g3_va_jump${s}`, testData.leftJump);
            setVal(`p1_g3_ho_jump${s}`, testData.rightJump);
            setVal(`p1_g3_va_gct${s}`, testData.leftGct);
            setVal(`p1_g3_ho_gct${s}`, testData.rightGct);
            setText(`comment_tia${s}`, testData.comment);
        } else if (testId === 'sidehop') {
            setVal(`p1_g4_va_count${s}`, testData.leftCount);
            setVal(`p1_g4_ho_count${s}`, testData.rightCount);
            setText(`comment_sidehop${s}`, testData.comment);
        } else if (testId === 'squat') {
            setVal(`p1_g5_attempt_1${s}`, testData.attempt1);
            setVal(`p1_g5_attempt_2${s}`, testData.attempt2);
            setVal(`p1_g5_attempt_3${s}`, testData.attempt3);
            setText(`comment_squat${s}`, testData.comment);
        } else if (testId === 'repeated_bilateral') {
            setVal(`p1_g6_avg_height${s}`, testData.avgHeight);
            setVal(`p1_g6_avg_gct${s}`, testData.avgGct);
            setText(`comment_repeated_bilateral${s}`, testData.comment);
        } else if (testId === 'cmj2ben') {
            setVal(`p1_g7_attempt_1${s}`, testData.attempt1);
            setVal(`p1_g7_attempt_2${s}`, testData.attempt2);
            setVal(`p1_g7_attempt_3${s}`, testData.attempt3);
            setText(`comment_cmj2ben${s}`, testData.comment);
        } else if (['hipthrust', 'quads', 'staticsquat-handdrag', 'staticsquat-hoftrem', 'hamstring'].includes(testId)) {
            const map = {
                hipthrust: 'p2_g1', quads: 'p2_g2', 'staticsquat-handdrag': 'p2_g3',
                'staticsquat-hoftrem': 'p2_g4', hamstring: 'p2_g5'
            };
            const base = map[testId];
            setVal(`${base}_va${s}`, testData.left);
            setVal(`${base}_ho${s}`, testData.right);
            if (testData.tva) setVal(`${base}_tva${s}`, testData.tva);
            if (testData.both) setVal(`${base}_tva${s}`, testData.both);

            let commentId = '';
            if (testId === 'hipthrust') commentId = 'comment_hipthrust';
            else if (testId === 'quads') commentId = 'comment_quads';
            else if (testId === 'staticsquat-handdrag') commentId = 'comment_squat_pull_handdrag';
            else if (testId === 'staticsquat-hoftrem') commentId = 'comment_squat_pull_hoftrem';
            else if (testId === 'hamstring') commentId = 'comment_hamstring';
            setText(`${commentId}${s}`, testData.comment);
        } else if (testId === 'nordic-hamstring') {
            setVal(`p2_g6_attempt_1${s}`, testData.attempt1);
            setVal(`p2_g6_attempt_2${s}`, testData.attempt2);
            setVal(`p2_g6_attempt_3${s}`, testData.attempt3);
            setText(`comment_nordic_hamstring${s}`, testData.comment);
        } else if (testId === 'manual') {
            if (testData.srp) { setVal(`p2_text_srp_tare${s}`, testData.srp.tare); setVal(`p2_text_srp_force${s}`, testData.srp.force); }
            if (testData.spts) { setVal(`p2_text_spts_kg${s}`, testData.spts.kg); }
            if (testData.mpu) { setVal(`p2_text_mpu_tare${s}`, testData.mpu.tare); setVal(`p2_text_mpu_force${s}`, testData.mpu.force); }
            if (testData.bpc) { setVal(`p2_text_bpc_hits${s}`, testData.bpc.hits); }
        } else {
            // Try Custom Test Population
            // Note: testId usually is 'custom_ID' or just 'ID' if legacy.
            // But if it is in data.page2.custom, we can look it up.

            let cData = null;
            let customId = testId;
            if (testId.startsWith('custom_')) {
                customId = testId.replace('custom_', '');
            }

            if (data.page2 && data.page2.custom && data.page2.custom[customId]) {
                cData = data.page2.custom[customId];
            }

            if (cData) {
                const baseKey = `custom_${customId}`;
                const setCVal = (suffix, val) => setVal(`${baseKey}_${suffix}${s}`, val);

                // Restore all potential fields (it's safe to try setting them even if they don't exist in DOM, setVal handles null check?)
                // setVal definition: const el = document.getElementById(id); if (el) el.value = val;
                // So it is safe.

                if (cData.val1 !== undefined) setCVal('val1', cData.val1);
                if (cData.val2 !== undefined) setCVal('val2', cData.val2);
                if (cData.val3 !== undefined) setCVal('val3', cData.val3);

                if (cData.val1_L !== undefined) setCVal('val1_L', cData.val1_L);
                if (cData.val1_R !== undefined) setCVal('val1_R', cData.val1_R);
                if (cData.val2_L !== undefined) setCVal('val2_L', cData.val2_L);
                if (cData.val2_R !== undefined) setCVal('val2_R', cData.val2_R);

                if (cData.val_L !== undefined) setCVal('val_L', cData.val_L);
                if (cData.val_R !== undefined) setCVal('val_R', cData.val_R);
                if (cData.val_Both !== undefined) setCVal('val_Both', cData.val_Both);

                if (cData.g1_L !== undefined) setCVal('g1_L', cData.g1_L);
                if (cData.g1_R !== undefined) setCVal('g1_R', cData.g1_R);
                if (cData.g2_L !== undefined) setCVal('g2_L', cData.g2_L);
                if (cData.g2_R !== undefined) setCVal('g2_R', cData.g2_R);
                if (cData.g3_L !== undefined) setCVal('g3_L', cData.g3_L);
                if (cData.g3_R !== undefined) setCVal('g3_R', cData.g3_R);

                if (cData.comment) setText(`comment_${baseKey}${s}`, cData.comment);
            }
        }
    });

    // Handle Patient Info & Navigation States
    if (data.patientInfo) {
        setVal('date', data.patientInfo.date);
        setVal('createdBy', data.patientInfo.createdBy);
        const domType = data.patientInfo.dominantSideType;
        if (domType) {
            const el = document.querySelector(`input[name="dominance_type"][value="${domType}"]`);
            if (el) el.checked = true;
        }

        const setTextContent = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        setTextContent('card-patient-name', data.patientInfo.name);
        setTextContent('card-patient-sport', data.patientInfo.sportPosition);
        setTextContent('card-patient-id', data.patientInfo.internalId);
        setTextContent('card-patient-injured-side', data.patientInfo.injuredSide);

        const dashboardWrapper = document.getElementById('active-patient-dashboard');
        if (dashboardWrapper) dashboardWrapper.style.display = 'block';
        const mainForms = document.getElementById('main-content-forms');
        if (mainForms) mainForms.style.display = 'block';
        const choiceContainer = document.getElementById('patient-choice-container');
        if (choiceContainer) choiceContainer.style.display = 'none';
        const searchContainer = document.getElementById('existing-patient-search-container');
        if (searchContainer) searchContainer.style.display = 'none';
    }

    updatePreview();
}


// --- INITIALIZATION ---
// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("Index.js: Auth detected, initializing data...");

            // 1. Fetch Tests
            try {
                const custom = await getCustomTests();
                window.allTests = [...window.STATIC_TESTS, ...custom];
                console.log("Index: Loaded custom tests, total:", window.allTests.length);
            } catch (e) {
                console.error("Index: Failed to load custom tests", e);
                window.allTests = [...window.STATIC_TESTS];
            }

            // 2. Render UI
            renderTestSelection();

            // 3. Restore Session
            loadDraft();

            // 4. Load Protocols (Ensure visible)
            loadAndRenderProtocolSelector();

        } else {
            console.log("Index.js: No user signed in. Redirecting to login.");
            window.location.href = 'login.html';
        }
    });

    // Output Listeners regarding saving
    const inputForm = document.getElementById('input-form');
    if (inputForm) {
        inputForm.addEventListener('input', (e) => {
            updatePreview();
            // Save Draft to LocalStorage on every input (Debounce logic if needed, but LS is fast)
            // Debounce slightly to avoid spamming
            clearTimeout(window.draftTimeout);
            window.draftTimeout = setTimeout(saveDraft, 500);
        });
    }

    // Explicitly attach Save Data Button Listener
    const sideSaveBtn = document.getElementById('save-data-sidebar-btn');
    if (sideSaveBtn) {
        sideSaveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            saveData();
        });
    }


    // Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).then(() => {
                console.log('User signed out.');
                window.location.href = 'index.html';
            }).catch((error) => {
                console.error('Sign out error', error);
            });
        });
    }

    // Patient Buttons
    const btnNewPatient = document.getElementById('btn-new-patient-workspace');
    if (btnNewPatient) {
        btnNewPatient.addEventListener('click', () => {
            console.log('New Patient button clicked');
            openNewPatientModal();
        });
    }

    const btnExistingPatient = document.getElementById('btn-existing-patient-workspace');
    if (btnExistingPatient) {
        btnExistingPatient.addEventListener('click', () => {
            console.log('Existing Patient button clicked');
            const searchModal = document.getElementById('search-modal-overlay');
            if (searchModal) {
                searchModal.style.display = 'flex';
                // Focus search input
                const searchInput = document.getElementById('patient-search-input-modal');
                if (searchInput) {
                    searchInput.value = ''; // Reset input
                    searchInput.focus();
                }

                // Load initial patients
                searchPatients('', 'search-results-list-modal');
            }
        });
    }

    // Modal Search Input Listener
    const searchInputModal = document.getElementById('patient-search-input-modal');
    if (searchInputModal) {
        searchInputModal.addEventListener('input', (e) => {
            searchPatients(e.target.value, 'search-results-list-modal');
        });
    }

    // Modal Close Button Listener
    const closeSearchModalBtn = document.getElementById('close-search-modal');
    const searchModalOverlay = document.getElementById('search-modal-overlay');
    if (closeSearchModalBtn && searchModalOverlay) {
        closeSearchModalBtn.addEventListener('click', () => {
            searchModalOverlay.style.display = 'none';
        });
    }

    // Close on click outside
    if (searchModalOverlay) {
        searchModalOverlay.addEventListener('click', (e) => {
            if (e.target === searchModalOverlay) {
                searchModalOverlay.style.display = 'none';
            }
        });
    }

});





// --- PDF GENERATION ---
document.addEventListener('DOMContentLoaded', () => {
    const pdfBtn = document.getElementById('pdf-preview');
    if (pdfBtn) {
        pdfBtn.addEventListener('click', (e) => {
            try {
                const data = collectDataFromForm();
                if (data) {
                    try {
                        localStorage.setItem('fysiosportData', JSON.stringify(data));
                        // Force cache bust for report.html
                        window.open('report.html?v=' + Date.now(), '_blank');
                    } catch (e) {
                        console.error("Storage/Open Error:", e);
                        alert("Kunde inte öppna rapporten: " + e.message);
                    }
                } else {
                    alert("Kunde inte samla in data. Kontrollera att tester är valda.");
                }
            } catch (err) {
                console.error("CRITICAL: collectDataFromForm crashed:", err);
                alert("Ett kritiskt fel uppstod vid datasamling: " + err.message);
            }
        });
    }
});

// --- NEW SEARCH LOGIC (Fixing Empty Results) ---
async function searchPatients_Attempt1(term) {
    const list = document.getElementById('search-results-list');
    if (!list) return;

    list.innerHTML = '<div style="padding:10px; color:rgba(255,255,255,0.6);">Söker...</div>';

    let q;
    // If term is empty or undefined, fetch recent 20 patients
    if (!term || term.trim() === '') {
        q = query(
            collection(db, "users", auth.currentUser.uid, "patients"),
            orderBy("createdAt", "desc"),
            limit(20)
        );
    } else {
        q = query(collection(db, "users", auth.currentUser.uid, "patients"));
    }

    try {
        const querySnapshot = await getDocs(q);
        list.innerHTML = '';
        const searchLower = term ? term.toLowerCase() : '';

        let found = 0;
        querySnapshot.forEach((doc) => {
            const p = doc.data();
            p.id = doc.id;

            const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
            const internalId = (p.internalId || '').toString().toLowerCase();

            if (!term || fullName.includes(searchLower) || internalId.includes(searchLower)) {
                found++;
                const btn = document.createElement('button');
                btn.className = 'patient-search-result-item';

                btn.innerHTML = `
                    <strong>${p.firstName} ${p.lastName}</strong>
                    <span class="meta-info">ID: ${p.internalId || '-'}</span>
                `;
                btn.onclick = () => selectPatient(p);
                list.appendChild(btn);
            }
        });

        if (found === 0) list.innerHTML = '<div style="padding:10px; color:rgba(255,255,255,0.6);">Inga patienter hittades.</div>';
    } catch (e) {
        console.error("Error searching: ", e);
        list.innerHTML = `<div style="padding:10px; color:rgba(255,100,100,0.8);">Fel vid sökning: ${e.message}</div>`;
    }
}

// --- ROBUST SEARCH LOGIC (Attempt 2: Fallback for Index + Dark Text) ---
// --- ROBUST SEARCH LOGIC (Attempt 3: Fetch All + Client Side Logic) ---
async function searchPatients(term, targetListId) {
    // Determine which list to use. If targetListId is provided, use it.
    // Otherwise try to find the visible one.
    let list;
    if (targetListId) {
        list = document.getElementById(targetListId);
    } else {
        // Fallback or default behavior: Try modal first, then inline
        const modalList = document.getElementById('search-results-list-modal');
        const inlineList = document.getElementById('search-results-list-inline');

        // Check visibility (offsetParent is null if display:none)
        if (modalList && modalList.offsetParent !== null) {
            list = modalList;
        } else if (inlineList && inlineList.offsetParent !== null) {
            list = inlineList;
        } else {
            // If neither is strictly visible, default to modal for now as it's the primary use case.
            // If both are null, this will also be null, and the function will return early.
            list = modalList || inlineList;
        }
    }

    if (!list) return;

    // Use dark text for Light Theme visibility
    list.innerHTML = '<div style="padding:10px; color:rgba(255,255,255,0.8);">Laddar alla patienter...</div>';

    try {
        // SIMPLIFIED QUERY: Fetch all patients (or reasonable limit) without orderBy to avoid index issues
        // If the list grows > 100 we might need indexes, but for now this guarantees data visibility
        const q = query(collection(db, "users", auth.currentUser.uid, "patients"), limit(100));

        console.log("Fetching patients with simplified query...");
        const querySnapshot = await getDocs(q);

        list.innerHTML = '';
        const searchLower = term ? term.toLowerCase() : '';
        let patients = [];

        querySnapshot.forEach((doc) => {
            const p = doc.data();
            p.id = doc.id;
            patients.push(p);
        });

        // Client-side Sort: Sort by createdAt desc (if available), else by name
        patients.sort((a, b) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA; // Descending
        });

        console.log(`Fetched ${patients.length} patients. Filtering for: "${searchLower}"`);

        let found = 0;
        patients.forEach(p => {
            const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
            const internalId = (p.internalId || '').toString().toLowerCase();

            // Filter
            if (!term || term.trim() === '' || fullName.includes(searchLower) || internalId.includes(searchLower)) {
                found++;
                const btn = document.createElement('button');
                btn.className = 'patient-search-result-item';
                btn.dataset.patientId = p.id; // Added robustness

                btn.innerHTML = `
                    <strong>${p.firstName} ${p.lastName}</strong>
                    <span class="meta-info">ID: ${p.internalId || '-'}</span>
                `;
                btn.onclick = () => selectPatient(p);
                list.appendChild(btn);
            }
        });

        if (found === 0) {
            list.innerHTML = '<div style="padding:10px; color:rgba(255,255,255,0.8);">Inga patienter hittades.</div>';
        }
    } catch (e) {
        console.error("Critical error searching patients: ", e);
        list.innerHTML = `<div style="padding:10px; color:rgba(255,100,100,1);">Kritisk fel vid hämtning: ${e.message}.<br>Kontrollera konsol.</div>`;
    }
}

// --- SWITCH PATIENT LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    const switchPatientBtn = document.getElementById('switch-patient-sidebar-btn');
    if (switchPatientBtn) {
        switchPatientBtn.addEventListener('click', () => {
            // Simple reload to reset state safely
            if (confirm('Är du säker på att du vill byta patient? Osparade ändringar kan gå förlorade.')) {
                window.location.reload();
            }
        });
    }
});

// --- STATE PERSISTENCE ---
function saveDraft() {
    console.log("saveDraft: Saving state...", { hasPatient: !!currentPatient });
    // Only save if we have a patient or some data
    // But even if no patient, form data might be valuable.
    const data = collectDataFromForm();

    // Get selected protocol
    const protocolSelect = document.getElementById('protocol-selector');
    const selectedProtocolId = protocolSelect ? protocolSelect.value : null;

    const state = {
        patient: currentPatient,
        data: data,
        selectedProtocolId: selectedProtocolId
    };
    localStorage.setItem('fysiosport_draft', JSON.stringify(state));
    console.log('saveDraft: Draft saved to localStorage', { protocolId: selectedProtocolId });
}

function loadDraft() {
    console.log("loadDraft: Attempting to load draft...");
    const draftJson = localStorage.getItem('fysiosport_draft');
    if (!draftJson) {
        console.log("loadDraft: No draft found.");
        return;
    }

    try {
        const state = JSON.parse(draftJson);
        console.log("loadDraft: State parsed", state);

        // Restore Patient
        if (state.patient) {
            console.log("loadDraft: Restoring patient", state.patient.firstName);
            selectPatient(state.patient);
        } else {
            console.log("loadDraft: No patient in saved state.");
        }

        // Restore Protocol Selection
        if (state.selectedProtocolId) {
            const protocolSelect = document.getElementById('protocol-selector');
            if (protocolSelect) {
                protocolSelect.value = state.selectedProtocolId;
                // Trigger change event to render protocol tests
                protocolSelect.dispatchEvent(new Event('change'));
                console.log("loadDraft: Protocol restored", state.selectedProtocolId);
            }
        }

        // Restore Form Data
        if (state.data) {
            // Give UI a moment to update from selectPatient if needed
            setTimeout(() => {
                console.log("loadDraft: Populating form data...");
                populateFormFromData(state.data);
                console.log('loadDraft: Form data restored');
            }, 500); // Increased timeout slightly to be safe
        }
    } catch (e) {
        console.error('Failed to load draft', e);
    }
}

// --- PROTOCOL MANAGEMENT LOGIC ---

// --- PROTOCOL MANAGEMENT LOGIC ---
// Moved to manage_protocols.js and manage_protocols.html



// --- CHART HELPERS ---



// --- MAIN VIEW SELECTOR (UPDATED) ---
async function loadAndRenderProtocolSelector() {
    console.log("loadAndRenderProtocolSelector: Started");
    const container = document.getElementById('protocol-selector');
    if (!container) {
        console.error("loadAndRenderProtocolSelector: Container #protocol-selector not found!");
        return;
    }
    container.innerHTML = 'Laddar protokoll...';
    container.style.display = 'flex'; // Ensure flex layout
    container.style.gap = '10px';
    container.style.flexWrap = 'wrap';

    try {
        console.log("loadAndRenderProtocolSelector: Fetching protocols...");
        const protocols = await getProtocols();
        console.log("loadAndRenderProtocolSelector: Fetched protocols:", protocols);

        container.innerHTML = ''; // Clear loading text

        if (protocols.length === 0) {
            container.innerHTML = '<span style="font-size:0.8rem; opacity:0.6; padding:10px;">Inga protokoll hittades.</span>';
            return;
        }

        protocols.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button'; // Prevent form submission
            btn.className = 'protocol-chip';
            btn.textContent = p.name;
            btn.dataset.protocolId = p.id;

            // Add tooltip with test count or names
            btn.title = `${p.name} (${p.testIds.length} tester)`;

            btn.onclick = () => {
                console.log("Protocol clicked:", p.name);
                setActiveProtocol(p.id, p.testIds);
            };
            container.appendChild(btn);
        });
    } catch (e) {
        console.error("Selector load error", e);
        container.innerHTML = '<span style="color:red; font-size:0.8rem;">Fel vid laddning av protokoll.</span>';
    }
}

function setActiveProtocol(id, testIds) {
    console.log("Setting active protocol:", id, testIds);
    const allChips = document.querySelectorAll('.protocol-chip');
    allChips.forEach(c => c.classList.remove('active'));

    const activeChip = document.querySelector(`.protocol-chip[data-protocol-id="${id}"]`);
    if (activeChip) activeChip.classList.add('active');

    // Make sure we pass the test IDs correctly
    if (Array.isArray(testIds)) {
        // Transform IDs: add 'custom_' prefix for custom tests
        const transformedIds = testIds.map(id => {
            // Check if this is a custom test by looking it up in allTests
            const testDef = window.allTests ? window.allTests.find(t => t.id === id) : null;
            if (testDef && (testDef.isCustom || testDef.type === 'custom')) {
                return `custom_${id}`;
            }
            return id; // Keep standard test IDs as-is
        });

        console.log("DEBUG: Transformed IDs for rendering:", transformedIds);
        renderTestSelection(transformedIds);
        // Trigger graph updates (since some fields might be pre-filled or empty)
        // setTimeout(updatePreview, 100); 
    } else {
        console.error("Invalid testIds for protocol:", testIds);
    }
}


