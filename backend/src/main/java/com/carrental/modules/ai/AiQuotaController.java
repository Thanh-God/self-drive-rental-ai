package com.carrental.modules.ai;

import com.carrental.security.Actor;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Today's AI allowance for the signed-in renter. Reading it never uses a question. */
@RestController
@RequestMapping("/api/v1/ai/quota")
public class AiQuotaController {
    private final AiDailyQuota quota;

    public AiQuotaController(AiDailyQuota quota) { this.quota = quota; }

    @GetMapping
    public Map<String, Object> current(@AuthenticationPrincipal Actor actor) {
        actor.require("USER");
        var s = quota.status(actor);
        return Map.of("limit", s.limit(), "used", s.used(), "remaining", s.remaining(),
            "resetAt", s.resetAt().toString(),
            "hotline", Map.of("number", s.hotline(), "sample", s.hotlineSample()));
    }
}
