import { money } from "../common/PageKit";
import { paymentSchedule } from "../../utils/paymentSchedule";

/** L3: summary of what the renter pays, when and where; details stay in the deposit and remaining-rent panels. */
export default function PaymentSchedule({ booking }) {
  const schedule = paymentSchedule(booking);
  if (!schedule) return null;
  return (
    <section className="panel mb-5 space-y-3" aria-label="Lịch thanh toán">
      <h2 className="text-lg font-semibold">Lịch thanh toán</h2>
      <dl className="space-y-2 text-sm">
        <div className="flex flex-wrap justify-between gap-2 border-b pb-2">
          <dt className="font-semibold">Tổng tiền thuê và phí tuyến</dt>
          <dd className="font-semibold">{money(schedule.total)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2" data-state={schedule.deposit.state}>
          <dt>1. Cọc giữ chỗ (tính vào tiền thuê) — {schedule.deposit.label}</dt>
          <dd>{money(schedule.deposit.amount)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2" data-state={schedule.remainder.state}>
          <dt>2. Phần còn lại — {schedule.remainder.label}</dt>
          <dd>{money(schedule.remainder.amount)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted">
        {schedule.demo ? "Bản thử nghiệm: không thu tiền thật. " : ""}
        Hóa đơn phát hành khi hoàn tất không chứng minh đã thanh toán. Cọc giữ chỗ không phải tiền đảm bảo thiệt hại.
      </p>
    </section>
  );
}
