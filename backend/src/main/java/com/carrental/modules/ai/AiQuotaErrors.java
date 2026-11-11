package com.carrental.modules.ai;

import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Daily AI allowance used up: a stable code plus reset time and the contact (marked when it is a sample
 * number). Kept in the ai module so common exception handling stays free of domain types; it must run
 * before the generic DomainException handler, which would otherwise answer with the message only.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AiQuotaErrors {
    @ExceptionHandler(AiQuotaExceededException.class)
    ResponseEntity<?> dailyLimit(AiQuotaExceededException e) {
        var q = e.quota;
        return ResponseEntity.status(e.status).body(Map.of(
            "message", e.getMessage(), "code", AiQuotaExceededException.CODE,
            "limit", q.limit(), "remaining", q.remaining(), "resetAt", q.resetAt().toString(),
            "hotline", Map.of("number", q.hotline(), "sample", q.hotlineSample())));
    }
}
