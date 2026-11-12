import { Field } from "../common/PageKit";
import { FUEL_STEPS, km } from "../../utils/handoverReadings";

/** L5: fuel gauge (0–8 steps) and odometer inputs for handover/return; shows the handover values at return. */
export default function HandoverReadingsFields({ kind, fuel, odometer, onFuel, onOdometer, required, baseline, disabled }) {
  const handover = kind === "HANDOVER";
  return (
    <fieldset className="space-y-3" aria-label={handover ? "Số liệu lúc giao xe" : "Số liệu lúc nhận trả"}>
      <legend className="text-sm font-semibold">
        {handover ? "Số liệu lúc giao xe" : "Số liệu lúc nhận trả"}
        {required ? " (bắt buộc)" : " (không bắt buộc — biên bản giao chưa có số liệu)"}
      </legend>
      {baseline ? (
        <p className="text-sm text-muted">
          Lúc giao: nhiên liệu {baseline.fuelLevel}/8 vạch · đồng hồ {km(baseline.odometerKm)}. Số km lúc trả không được nhỏ hơn.
        </p>
      ) : null}
      <div className="grid gap-3">
        <Field label="Mức nhiên liệu / pin (thang 8 vạch)">
          <select value={fuel} required={required} disabled={disabled} onChange={(e) => onFuel(e.target.value)}>
            <option value="">Chọn mức</option>
            {FUEL_STEPS.map((step) => (
              <option key={step} value={String(step)}>{step}/8 vạch{step === 8 ? " (đầy)" : step === 0 ? " (cạn)" : ""}</option>
            ))}
          </select>
        </Field>
        <Field label="Số km trên đồng hồ">
          <input type="number" inputMode="numeric" min={baseline ? baseline.odometerKm : 0} step="1" required={required}
            value={odometer} disabled={disabled} onChange={(e) => onOdometer(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted">Chỉ ghi số liệu để đối chiếu; chưa tính phí nhiên liệu hoặc số km.</p>
    </fieldset>
  );
}
