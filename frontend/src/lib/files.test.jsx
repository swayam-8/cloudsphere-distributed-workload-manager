import { expect, test } from 'vitest';
import { previewCSV, UPLOAD_LIMIT, validateFile } from './files';

test('CSV preview reads quoted commas, escaped quotes, multiline fields and BOM',()=>{
  const result=previewCSV('\uFEFFcategory,amount,note\r\n"books, magazines",12.50,"a ""quote"""\r\nhardware,32,"two\nlines"\r\n');
  expect(result.headers).toEqual(['category','amount','note']);
  expect(result.rows).toEqual([['books, magazines','12.50','a "quote"'],['hardware','32','two\nlines']]);
  expect(result.numeric).toEqual(['amount']);
});
test('preview is bounded and file checks catch missing, oversized and incompatible inputs',()=>{
  expect(previewCSV('a,b\n'+Array.from({length:20},(_,i)=>`${i},${i+1}`).join('\n')).rows).toHaveLength(5);
  expect(validateFile(null,'csv')).toMatch(/nonempty/);
  expect(validateFile({name:'data.csv',size:UPLOAD_LIMIT+1},'csv')).toMatch(/10 MB/);
  expect(validateFile({name:'data.png',size:5},'csv')).toMatch(/CSV/);
  expect(validateFile({name:'DATA.CSV',size:5},'csv')).toBe('');
});
