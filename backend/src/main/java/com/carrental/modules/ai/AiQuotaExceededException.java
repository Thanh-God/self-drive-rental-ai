package com.carrental.modules.ai;

import com.carrental.exception.DomainException;
import org.springframework.http.HttpStatus;

/** Today's AI allowance is used up. Carries the details the client needs to explain it and offer a contact. */
public class AiQuotaExceededException extends DomainException {
    public static final String CODE = "AI_DAILY_LIMIT";
    public final AiDailyQuota.Status quota;

    public AiQuotaExceededException(AiDailyQuota.Status quota) {
        super(HttpStatus.TOO_MANY_REQUESTS, "Bạn đã dùng hết " + quota.limit() + " lượt hỏi trợ lý AI hôm nay. "
            + "Bạn vẫn có thể tìm xe bằng trang Tìm xe hoặc liên hệ nhân viên qua hotline " + quota.hotline()
            + (quota.hotlineSample() ? " (số mẫu dùng cho bản demo)." : "."));
        this.quota = quota;
    }
}
