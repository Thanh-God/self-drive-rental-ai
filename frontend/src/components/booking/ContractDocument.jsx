import { dateTime, money } from "../common/PageKit";

// L7 (12/11/2026): contracts issued from terms version contract-2026-11-12 carry numbered articles and the parties,
// vehicle and branch facts copied at issue time. Older contracts have no `articles` and keep the earlier layout.
export function isNumberedContract(doc) {
  return Array.isArray(doc?.articles) && doc.articles.length > 0;
}

const transmissionLabel = (value) => (value === "AUTO" ? "Số tự động" : value === "MANUAL" ? "Số sàn" : value);

function Row({ label, children }) {
  if (children == null || children === "") return null;
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-6 border-t pt-4" aria-label={title}>
      <h3 className="mb-3 font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const place = (name, address) => (address ? `${name} — ${address}` : name);

/** Numbered contract body. `formatDate(key, value)` formats startAt/endAt the way the booking pages do. */
export default function ContractDocument({ doc, formatDate, children }) {
  const lessor = doc.lessor || {};
  const license = doc.license;
  const deposit = Number(doc.depositAmount || 0);
  return (
    <div data-testid="contract-document">
      <header className="pb-2 text-center">
        <p className="text-sm font-semibold text-teal-800">KDrive</p>
        <h2 className="mt-1 text-xl font-bold uppercase">Hợp đồng thuê xe tự lái</h2>
        <p className="mt-2 text-sm text-slate-600">
          Số: <strong data-testid="contract-number">{doc.contractNumber}</strong>
          {doc.issuedAt ? <> · Lập lúc {dateTime(doc.issuedAt)}</> : null}
        </p>
      </header>

      <Section title="Các bên">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <dl className="space-y-2">
            <p className="font-semibold">Bên cho thuê</p>
            <Row label="Tên">{lessor.name}</Row>
            <Row label="Đại diện">{lessor.representative}</Row>
            <Row label="Địa chỉ giao dịch">{lessor.address}</Row>
            <Row label="Hotline">{lessor.hotline ? `${lessor.hotline}${lessor.sample ? " (số minh họa)" : ""}` : null}</Row>
          </dl>
          <dl className="space-y-2">
            <p className="font-semibold">Bên thuê</p>
            <Row label="Họ tên">{doc.customer}</Row>
            <Row label="Điện thoại">{doc.customerPhone}</Row>
            <Row label="Email">{doc.customerEmail}</Row>
            <Row label="Giấy phép lái xe">{license?.number ? `${license.number}${license.licenseClass ? ` · hạng ${license.licenseClass}` : ""}` : null}</Row>
          </dl>
        </div>
      </Section>

      <Section title="Xe, thời gian và địa điểm">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Row label="Xe">{doc.vehicle}</Row>
          <Row label="Biển số">{doc.vehiclePlate}</Row>
          <Row label="Số chỗ · hộp số">{doc.vehicleSeats ? `${doc.vehicleSeats} chỗ · ${transmissionLabel(doc.vehicleTransmission)}` : null}</Row>
          <Row label="Số ngày thuê">{doc.rentalDays ? `${doc.rentalDays} ngày` : null}</Row>
          <Row label="Nhận xe">{place(doc.pickup, doc.pickupAddress)}</Row>
          <Row label="Trả xe">{place(doc.return, doc.returnAddress)}</Row>
          <Row label="Thời điểm nhận">{doc.startAt ? formatDate("startAt", doc.startAt) : null}</Row>
          <Row label="Thời điểm trả">{doc.endAt ? formatDate("endAt", doc.endAt) : null}</Row>
        </dl>
      </Section>

      <Section title="Giá thuê và thanh toán">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Row label="Tiền thuê xe">{money(doc.rentalTotal)}</Row>
          {Number(doc.oneWayFee) > 0 ? <Row label="Phí trả khác chi nhánh">{money(doc.oneWayFee)}</Row> : null}
          <Row label="Tổng tiền">{money(doc.total)}</Row>
          {deposit > 0 ? <Row label="Tiền cọc giữ chỗ">{money(deposit)}</Row> : null}
          {doc.remainingRent != null ? <Row label={deposit > 0 ? "Còn lại sau cọc" : "Thanh toán tại chi nhánh"}>{money(doc.remainingRent)}</Row> : null}
        </dl>
      </Section>

      {children}

      <Section title="Điều khoản">
        <ol className="space-y-4 text-sm text-slate-700">
          {doc.articles.map((article) => (
            <li key={article.number} data-testid={`contract-article-${article.number}`}>
              <p className="font-semibold text-slate-900">Điều {article.number}. {article.title}</p>
              <ol className="mt-1 space-y-1">
                {(article.clauses || []).map((clause, index) => (
                  <li key={index}>
                    {article.number}.{index + 1}. {clause}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </Section>

      {doc.termsNote ? (
        <p className="mt-6 rounded-md bg-slate-50 p-3 text-xs text-slate-500" data-testid="contract-note">
          Ghi chú: {doc.termsNote}
        </p>
      ) : null}
    </div>
  );
}
