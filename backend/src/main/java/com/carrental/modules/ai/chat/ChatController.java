package com.carrental.modules.ai.chat;

import com.carrental.modules.ai.AiDailyQuota;
import com.carrental.modules.ai.AiRequestDeadline;
import com.carrental.modules.ai.knowledge.KnowledgeBase;
import com.carrental.security.Actor;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** KDrive question answering for signed-in renters. The conversation lives in the client; nothing is stored. */
@RestController
@RequestMapping("/api/v1/ai/chat")
public class ChatController {
    public record TurnInput(@NotNull @Pattern(regexp = "user|assistant") String role,
                            @NotBlank @Size(max = ChatPromptBuilder.MAX_MESSAGE) String text) {}

    public record Request(@NotBlank @Size(max = ChatPromptBuilder.MAX_MESSAGE) String message,
                          @Size(max = 20) List<@NotNull @Valid TurnInput> messages) {}

    public record Citation(String id, String title) {}

    public record Response(String intent, String reply, List<Citation> citations, String knowledgeVersion,
                           Map<String, Object> quota) {}

    private final ChatService chat;
    private final KnowledgeBase knowledge;
    private final AiDailyQuota quota;

    public ChatController(ChatService chat, KnowledgeBase knowledge, AiDailyQuota quota) {
        this.chat = chat;
        this.knowledge = knowledge;
        this.quota = quota;
    }

    @PostMapping
    public Response ask(@AuthenticationPrincipal Actor actor, @Valid @RequestBody Request request) {
        var deadline = AiRequestDeadline.start(AiRequestDeadline.Operation.CHAT);
        var history = request.messages() == null ? List.<ChatPromptBuilder.Turn>of() : request.messages().stream()
            .map(t -> new ChatPromptBuilder.Turn("user".equals(t.role()) ? ChatPromptBuilder.Role.USER : ChatPromptBuilder.Role.ASSISTANT, t.text()))
            .toList();
        var answer = chat.answer(actor, request.message(), history, deadline);
        var citations = answer.citations().stream()
            .map(id -> new Citation(id, knowledge.find(id).orElseThrow().questions().get(0))).toList();
        var s = quota.status(actor);
        return new Response(answer.intent(), answer.reply(), citations, answer.knowledgeVersion(), Map.of(
            "limit", s.limit(), "used", s.used(), "remaining", s.remaining(), "resetAt", s.resetAt().toString(),
            "hotline", Map.of("number", s.hotline(), "sample", s.hotlineSample())));
    }
}
