import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getErrorMessage} from './roles.js';
test('timeout reports unknown write outcome instead of success or raw English',()=>{
 for(const code of ['ECONNABORTED','ETIMEDOUT']){
  const message=getErrorMessage({code,message:'timeout of 20000ms exceeded'});
  assert.match(message,/Chưa xác nhận thao tác đã được lưu/);assert.match(message,/tải lại thông tin trước khi thử lại/);assert.doesNotMatch(message,/20000ms|thành công/);
 }
});
test('server errors remain authoritative even when timeout code is attached',()=>{
 assert.equal(getErrorMessage({code:'ECONNABORTED',response:{data:{message:'Hồ sơ đã thay đổi.'}}}),'Hồ sơ đã thay đổi.');
 assert.equal(getErrorMessage({},'Không thể lưu GPLX.'),'Không thể lưu GPLX.');
});
