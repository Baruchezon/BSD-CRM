import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {originFields} from '../supabase/functions/match-suggestions-report/engine.js';
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../js/record-origin.js',import.meta.url),'utf8'),context);
const origin=context.BSDOrigin;
test('referral credit is displayed separately from entry and source channel',()=>{
 const row={referred_by_agent_name:'סוכן מקורי',origin_entered_by_name:'מטפל אחר',original_source:'facebook',source:'טלפון'};
 assert.equal(origin.text(row),'הובא על ידי: סוכן מקורי · מקור: פייסבוק');
 assert.equal(origin.text({origin_entered_by_name:'ברוך',source:'phone'}),'הוזן על ידי: ברוך · מקור: טלפון');
 assert.equal(origin.text({source:'website'}),'מקור: אתר');
 assert.equal(origin.text({}),'מקור לא תועד');
});
test('anonymous business matches do not disclose another agents identity',()=>{
 const row={_anon_scope:true,referred_by_agent_name:'סוכן סודי',origin_entered_by_name:'יוצר סודי',source:'secret_source'};
 const fields=originFields(row);
 assert.deepEqual(fields,{_anonymous:true});
 assert.ok(!JSON.stringify(fields).includes('סודי'));
 assert.equal(origin.text(row),'פרטי המקור שמורים להנהלת BSD');
});
test('HTML escapes names and the smart matching projection keeps only origin labels',()=>{
 assert.ok(!origin.html({referred_by_agent_name:'<img onerror=alert(1)>'}).includes('<img'));
 const fields=originFields({referred_by_agent_name:'רינה',origin_entered_by_name:'ברוך',original_source:'facebook',phone:'secret',id_number:'private'});
 assert.equal(fields.referred_by_agent_name,'רינה');assert.equal(fields.phone,undefined);assert.equal(fields.id_number,undefined);
});
