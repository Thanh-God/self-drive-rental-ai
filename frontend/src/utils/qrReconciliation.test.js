import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qrReconciliationStageLabel, qrReconciliationStages } from './qrReconciliation.js';

const labels = {
  AWAITING_APPROVAL: 'Chờ kiểm tra hồ sơ',
  AWAITING_TRANSFER: 'Chờ khách chuyển cọc',
  REPORTED_NO_RECEIPT: 'Khách đã báo chuyển — chờ đối chiếu',
  RECEIVED_INCOMPLETE: 'Cần đối soát khoản nhận',
  AWAITING_APPLICATION: 'Đã nhận đủ khoản hợp lệ — chờ xác nhận đơn',
  APPLIED: 'Đã ghi nhận cọc vào đơn',
  EXPIRED: 'Đã hết hạn',
  CLOSED: 'Đã kết thúc xử lý cọc',
};

test('all backend reconciliation stages have their agreed Vietnamese labels', () => {
  assert.deepEqual(qrReconciliationStages, Object.keys(labels));
  for (const [stage, label] of Object.entries(labels)) {
    assert.equal(qrReconciliationStageLabel({ stage }), label);
  }
});

test('missing and unknown reconciliation stages use neutral fallback labels', () => {
  for (const summary of [undefined, null, {}, { stage: null }, { stage: '' }]) {
    assert.equal(qrReconciliationStageLabel(summary), 'Chưa có thông tin đối soát');
  }
  assert.equal(qrReconciliationStageLabel({ stage: 'FUTURE_STAGE' }), 'Trạng thái đối soát chưa được hỗ trợ');
  assert.doesNotMatch(qrReconciliationStageLabel({ stage: 'FUTURE_STAGE' }), /chưa chuyển|chưa thanh toán|chưa đóng cọc/i);
});