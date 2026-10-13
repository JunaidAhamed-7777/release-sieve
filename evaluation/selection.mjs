import { audit } from '../src/audit.mjs';
import { lexicalEmbed } from './lexical.mjs';
import { evaluateScenario,summarizeEvaluation } from './metrics.mjs';

export const THRESHOLDS=Object.freeze([0.1,0.2,0.3,0.4,0.48,0.5,0.6,0.7,0.8,0.9]);
export const MARGINS=Object.freeze([0,0.03,0.06,0.1,0.15,0.2]);

export function selectOperatingPoint(points) {
  const feasible=points.filter(point=>point.unsafeAccepted===0);
  feasible.sort((a,b)=>b.correctAccepted-a.correctAccepted||b.threshold-a.threshold||b.margin-a.margin);
  return feasible[0]?{mode:'gates',threshold:feasible[0].threshold,margin:feasible[0].margin,calibration:feasible[0]}:{mode:'always-review',calibration:null};
}

/** Only the supplied calibration scenarios are consulted by this selection. */
export async function calibrateLexical(scenarios) {
  const points=[];
  for(const threshold of THRESHOLDS)for(const margin of MARGINS){
    const rows=[];
    for(const scenario of scenarios){
      const report=await audit({...scenario,threshold,margin,embed:lexicalEmbed});
      rows.push(...evaluateScenario(scenario,report));
    }
    const summary=summarizeEvaluation(rows).ordinary;
    points.push({threshold,margin,correctAccepted:summary.counts.correctAccepted,unsafeAccepted:summary.counts.falseReassurance,accepted:summary.counts.accepted,reviewed:summary.counts.actual.review});
  }
  return {...selectOperatingPoint(points),grid:points};
}

export async function lexicalReport(scenario,operatingPoint) {
  const report=await audit({...scenario,threshold:operatingPoint.threshold??0.48,margin:operatingPoint.margin??0.06,embed:lexicalEmbed});
  if(operatingPoint.mode==='always-review'){
    for(const change of report.changes)if(change.status==='matched'){change.status='review';change.reason='Calibration supplied no feasible lexical gate; this baseline abstains.';}
    report.summary.matched=0;
    report.summary.needsReview=report.changes.filter(change=>change.status==='review').length;
    for(const note of report.notes){note.matches=[];note.status=note.reviewMatches.length?'review':'unlinked';}
  }
  return report;
}
