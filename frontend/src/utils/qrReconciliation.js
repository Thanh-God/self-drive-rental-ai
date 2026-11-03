const stageLabels = Object.freeze({
  AWAITING_APPROVAL: 'Chờ kiểm tra hồ sơ',
  AWAITING_TRANSFER: 'Chờ khách chuyển cọc',
  REPORTED_NO_RECEIPT: 'Khách đã báo chuyển — chờ đối chiếu',
  RECEIVED_INCOMPLETE: 'Cần đối soát khoản nhận',
  AWAITING_APPLICATION: 'Đã nhận đủ khoản hợp lệ — chờ xác nhận đơn',
  APPLIED: 'Đã ghi nhận cọc vào đơn',
  EXPIRED: 'Đã hết hạn',
  CLOSED: 'Đã kết thúc xử lý cọc',
});

export const qrReconciliationStages = Object.freeze(Object.keys(stageLabels));

export function qrReconciliationStageLabel(summary) {
  if (!summary || typeof summary !== 'object' || !summary.stage) {
    return 'Chưa có thông tin đối soát';
  }
  return stageLabels[summary.stage] || 'Trạng thái đối soát chưa được hỗ trợ';
}