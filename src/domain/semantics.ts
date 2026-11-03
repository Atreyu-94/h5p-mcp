import {RE2JS} from 're2js';
import type {Native} from './types.js';
// Scalar rules are independent of Lumi, storage, and network access.
const regexps = new WeakMap<object,RE2JS|Error>();
export function compileRegexp(entry: Native): RE2JS|Error {
 const cached=regexps.get(entry);
 if(cached)return cached;
 let compiled:RE2JS|Error;
 try {
   const {pattern,modifiers=''}=entry.regexp;
   if(typeof pattern!=='string'||pattern.length>2048||typeof modifiers!=='string'||/[^dgimsuy]/.test(modifiers))
     throw new Error('Invalid schema regexp');
   // Parse ECMAScript syntax and flags, but never execute package patterns with its backtracking engine.
   const source=new RegExp(pattern,modifiers);
   compiled=RE2JS.compile(RE2JS.translateRegExp(source));
 } catch {compiled=new Error('Unsupported or invalid schema regexp');}
 regexps.set(entry,compiled);
 return compiled;
}
export function scalarErrors(entry: Native, value: unknown): string[] {
  const errors = [];
  if (entry.type === 'text') {
    if (typeof value !== 'string') return ['expected text'];
    if (entry.widget !== 'html' && entry.maxLength != null && value.length > entry.maxLength)
      return [`maximum length ${entry.maxLength}`];
    if (entry.regexp) {
      try {
        const regexp=compileRegexp(entry);
        if(regexp instanceof Error) throw regexp;
        const matches=entry.regexp.modifiers?.includes('y') ? regexp.matcher(value).lookingAt() : regexp.test(value);
        if (!matches) errors.push('text does not match regexp');
      } catch { errors.push('unsupported or invalid schema regexp'); }
    }
  }
  if (entry.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return ['expected finite number'];
    if (entry.min != null && value < entry.min) errors.push(`minimum ${entry.min}`);
    if (entry.max != null && value > entry.max) errors.push(`maximum ${entry.max}`);
    if (entry.decimals != null) {
      // Decimal representation avoids false failures from binary multiplication.
      const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
      const digits = Math.max(0, (mantissa.split('.')[1] || '').length - Number(exponent));
      if (digits > entry.decimals) errors.push(`maximum ${entry.decimals} decimal digits`);
    }
  }
  return errors;
}
