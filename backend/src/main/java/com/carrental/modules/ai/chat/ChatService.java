package com.carrental.modules.ai.chat;

import com.carrental.exception.DomainException;
import com.carrental.modules.ai.AiDailyQuota;
import com.carrental.modules.ai.AiRequestDeadline;
import com.carrental.security.Actor;
import org.springframework.beans.factory.annotation.Autowired;
import com.carrental.modules.ai.knowledge.KnowledgeBase;
import com.carrental.modules.ai.knowledge.KnowledgeRetriever;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * One grounded chat answer. The model only drafts; the backend decides what the customer sees:
 * citations must name passages that were offered, an answer without one becomes the approved "no
 * information" reply, refusals use the approved wording, money amounts the passages do not contain are
 * withdrawn, and suspected instruction injection without grounding gets the approved out-of-scope reply.
 */
@Service
public class ChatService {
    public enum Guard {
        /** Injection pattern and nothing relevant in the knowledge: answered without calling the model. */
        INJECTION_NO_PASSAGE,
        /** Model cited an ID that was not offered; the citation was dropped. */
        UNKNOWN_CITATION,
        /** ANSWER without a valid citation, replaced by the approved fallback reply. */
        UNGROUNDED_ANSWER,
        /** OUT_OF_SCOPE with free text, replaced by the approved refusal. */
        REFUSAL_REWORDED,
        /** OUT_OF_SCOPE for a rental-related question the knowledge does not cover: the approved fallback instead. */
        OUT_OF_SCOPE_IN_DOMAIN,
        /** A money amount not present in the cited passages or the question, withdrawn. */
        UNSUPPORTED_AMOUNT,
        /** Injection pattern and the reply had no valid citation, replaced by the approved refusal. */
        INJECTION_UNGROUNDED,
        /** ANSWER whose reply is an approved refusal: labelled OUT_OF_SCOPE, sources dropped. */
        REFUSAL_RELABELLED,
        /** The approved "no information" reply came with citations; they were dropped. */
        FALLBACK_SOURCES_DROPPED,
        /** Sample hotline mentioned without its sample label; the label was added. */
        HOTLINE_LABEL_ADDED
    }

    /** {@code criteria}, {@code missing} and {@code cards} are set only for a vehicle-search turn. */
    public record Answer(String intent, String reply, List<String> citations, String knowledgeVersion, List<Guard> guards,
                         ChatVehicleSearch.Session criteria, List<String> missing, List<ChatVehicleSearch.Card> cards) {
        public Answer(String intent, String reply, List<String> citations, String knowledgeVersion, List<Guard> guards) {
            this(intent, reply, citations, knowledgeVersion, guards, null, List.of(), List.of());
        }
    }

    private static final Pattern INJECTION = Pattern.compile(
        "\\b(?:bo qua|phot lo|quen|ignore|disregard|forget)\\b.{0,40}\\b(?:chi dan|huong dan|quy tac|lenh|instruction|instructions|rules|prompt)\\b"
        + "|\\bsystem\\s*prompt\\b|\\bprompt he thong\\b|\\bdong vai\\b|\\byou are now\\b|\\bact as\\b|\\bjailbreak\\b"
        + "|\\b(?:tiet lo|in ra|hien thi)\\b.{0,30}\\b(?:prompt|huong dan|quy tac|chi dan)\\b|(?:^|\\s)system\\s*:");
    private static final Pattern AMOUNT = Pattern.compile(
        "\\d[\\d.,]*\\s*(?:%|d\\b|vnd\\b|dong\\b|nghin\\b|ngan\\b|k\\b|trieu\\b|tr\\b)");
    /** Folded words that place a question in the KDrive rental domain. */
    private static final Pattern DOMAIN = Pattern.compile(
        "\\b(?:xe|thue|kdrive|chuyen di|don thue|chi nhanh|gplx|bang lai|giay phep|coc|hoan tien|huy don|nhan xe|tra xe|"
        + "bao hiem|xang|nhien lieu|km|phat nguoi|hop dong|hoa don|su co|tai nan|chia khoa|lai xe|hotline)\\b");
    private static final String ASK_WITHOUT_AMOUNT =
        "Bạn cho mình biết ngày nhận, ngày trả, điểm nhận/trả, số người và tổng ngân sách để mình gợi ý xe nhé. "
        + "Giá chính xác hiển thị ở bước báo giá.";

    private final KnowledgeBase knowledge;
    private final KnowledgeRetriever retriever;
    private final ChatPromptBuilder builder;
    private final ObjectProvider<QwenChatModel> model;
    private final AiDailyQuota quota;
    private final ChatVehicleSearch search;

    @Autowired
    public ChatService(KnowledgeBase knowledge, KnowledgeRetriever retriever, ChatPromptBuilder builder,
                       ObjectProvider<QwenChatModel> model, AiDailyQuota quota, ChatVehicleSearch search) {
        this.knowledge = knowledge;
        this.retriever = retriever;
        this.builder = builder;
        this.model = model;
        this.quota = quota;
        this.search = search;
    }

    /** Question answering only (no vehicle search), with a daily limit. */
    public ChatService(KnowledgeBase knowledge, KnowledgeRetriever retriever, ChatPromptBuilder builder,
                       ObjectProvider<QwenChatModel> model, AiDailyQuota quota) {
        this(knowledge, retriever, builder, model, quota, null);
    }

    /** No daily limit: unit tests and offline tools. */
    public ChatService(KnowledgeBase knowledge, KnowledgeRetriever retriever, ChatPromptBuilder builder,
                       ObjectProvider<QwenChatModel> model) {
        this(knowledge, retriever, builder, model, AiDailyQuota.unlimited());
    }

    /**
     * A renter's question. Refused input (400), a disabled assistant (503), a busy provider (429), provider
     * errors and timeouts do not use the daily allowance; an answer given without the model does not either.
     */
    public Answer answer(Actor actor, String message, List<ChatPromptBuilder.Turn> history, AiRequestDeadline deadline) {
        return answer(actor, message, history, null, deadline);
    }

    /** As above, with the vehicle-search criteria the client carried from earlier turns (may be null). */
    public Answer answer(Actor actor, String message, List<ChatPromptBuilder.Turn> history,
                         ChatVehicleSearch.Session session, AiRequestDeadline deadline) {
        actor.require("USER");
        return answer(message, history, deadline, actor, session);
    }

    public Answer answer(String message, List<ChatPromptBuilder.Turn> history, AiRequestDeadline deadline) {
        return answer(message, history, deadline, null, null);
    }

    private Answer answer(String message, List<ChatPromptBuilder.Turn> history, AiRequestDeadline deadline, Actor actor,
                          ChatVehicleSearch.Session session) {
        var passages = retriever.retrieve(message);
        var prompt = builder.build(message, history, passages); // 400 for blank, oversized or sensitive input
        boolean injection = looksLikeInjection(message);
        var guards = new ArrayList<Guard>();
        if (injection && passages.isEmpty()) {
            guards.add(Guard.INJECTION_NO_PASSAGE);
            return new Answer("OUT_OF_SCOPE", refusal("K-G01"), List.of(), knowledge.version(), List.copyOf(guards));
        }
        var engine = model.getIfAvailable();
        if (engine == null) throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "Chưa bật trợ lý hỏi đáp.");
        boolean searching = actor != null && search != null;
        var hints = searching ? search.hints(message) : QwenChatModel.SearchHints.NONE;
        QwenChatModel.Reply drafted;
        if (actor == null) drafted = engine.ask(prompt, deadline, hints);
        else try (var held = quota.reserve(actor)) {
            drafted = engine.ask(prompt, deadline, hints);
            held.commit();
        }
        var checked = check(drafted, prompt, message, injection, guards);
        if (!searching || !Set.of("SEARCH_VEHICLES", "ASK_MISSING").contains(checked.intent())) return checked;
        // One model call per message: the same reply carries the criteria draft; the backend does the search.
        var found = search.run(actor, message, drafted.criteria(), session);
        return new Answer(found.intent(), found.reply(), List.of(), knowledge.version(), checked.guards(),
            found.criteria(), found.missing(), found.cards());
    }

    Answer check(QwenChatModel.Reply drafted, ChatPromptBuilder.Prompt prompt, String message, boolean injection, List<Guard> guards) {
        String intent = drafted.intent();
        String reply = drafted.reply();
        var citations = new ArrayList<String>();
        for (String id : drafted.citations()) {
            if (prompt.passageIds().contains(id)) citations.add(id);
            else if (!guards.contains(Guard.UNKNOWN_CITATION)) guards.add(Guard.UNKNOWN_CITATION);
        }
        if (!"ANSWER".equals(intent)) citations.clear();
        if ("ANSWER".equals(intent) && isApprovedRefusal(reply)) {
            // C5.2-F1: an approved refusal is a refusal whatever label the model gave it, and it has no sources.
            guards.add(Guard.REFUSAL_RELABELLED);
            intent = "OUT_OF_SCOPE";
            citations.clear();
        } else if ("ANSWER".equals(intent) && !citations.isEmpty()
                && wordsOnly(reply).equals(wordsOnly(knowledge.fallbackReply()))) {
            // C5.2-F2: "no information" cites nothing, otherwise the UI shows a source next to it.
            guards.add(Guard.FALLBACK_SOURCES_DROPPED);
            citations.clear();
        }

        if (injection && citations.isEmpty() && !isApprovedRefusal(reply)) {
            guards.add(Guard.INJECTION_UNGROUNDED);
            return done("OUT_OF_SCOPE", refusal("K-G01"), List.of(), guards);
        }
        switch (intent) {
            case "OUT_OF_SCOPE" -> {
                String approved = approvedRefusal(reply);
                boolean general = approved == null || approved.equals(refusal("K-G01"));
                if (general && inDomain(message)) {
                    // A rental question the knowledge does not cover is not off-topic: say we have no information.
                    guards.add(Guard.OUT_OF_SCOPE_IN_DOMAIN);
                    return done("ANSWER", knowledge.fallbackReply(), List.of(), guards);
                }
                if (approved == null) {
                    guards.add(Guard.REFUSAL_REWORDED);
                    approved = refusal("K-G01");
                }
                return done(intent, approved, List.of(), guards);
            }
            case "ANSWER" -> {
                if (citations.isEmpty()) {
                    if (wordsOnly(reply).equals(wordsOnly(knowledge.fallbackReply())) || isApprovedRefusal(reply))
                        return done(intent, isApprovedRefusal(reply) ? approvedRefusal(reply) : knowledge.fallbackReply(), List.of(), guards);
                    guards.add(Guard.UNGROUNDED_ANSWER);
                    return done(intent, knowledge.fallbackReply(), List.of(), guards);
                }
                var cited = new StringBuilder(message).append('\n');
                for (String id : citations) cited.append(knowledge.find(id).orElseThrow().answer()).append('\n');
                if (!amountsSupported(reply, cited.toString())) {
                    guards.add(Guard.UNSUPPORTED_AMOUNT);
                    reply = knowledge.find(citations.get(0)).orElseThrow().answer();
                }
                return done(intent, labelHotline(reply, guards), List.copyOf(citations), guards);
            }
            default -> { // SEARCH_VEHICLES, ASK_MISSING: no knowledge citation; amounts only from the customer
                if (!amountsSupported(reply, message)) {
                    guards.add(Guard.UNSUPPORTED_AMOUNT);
                    reply = ASK_WITHOUT_AMOUNT;
                }
                return done(intent, labelHotline(reply, guards), List.of(), guards);
            }
        }
    }

    private Answer done(String intent, String reply, List<String> citations, List<Guard> guards) {
        return new Answer(intent, reply, citations, knowledge.version(), List.copyOf(guards));
    }

    private String refusal(String id) { return knowledge.find(id).orElseThrow().answer(); }

    private boolean isApprovedRefusal(String reply) { return approvedRefusal(reply) != null; }

    private String approvedRefusal(String reply) {
        String key = wordsOnly(reply);
        for (String id : List.of("K-G01", "K-G02", "K-G03"))
            if (key.equals(wordsOnly(refusal(id)))) return refusal(id);
        return null;
    }

    private String labelHotline(String reply, List<Guard> guards) {
        if (knowledge.hotlineSample() && reply.contains(knowledge.hotline()) && !fold(reply).contains("mau")) {
            guards.add(Guard.HOTLINE_LABEL_ADDED);
            return reply.replace(knowledge.hotline(), knowledge.hotline() + " (số mẫu dùng cho bản demo)");
        }
        return reply;
    }

    static boolean inDomain(String text) {
        return DOMAIN.matcher(fold(text)).find();
    }

    static boolean looksLikeInjection(String text) {
        return INJECTION.matcher(fold(text)).find();
    }

    /** Every money amount or percentage in {@code reply} also appears, digit for digit, in {@code source}. */
    static boolean amountsSupported(String reply, String source) {
        var allowed = new HashSet<String>();
        var s = AMOUNT.matcher(fold(source));
        while (s.find()) allowed.add(digits(s.group()));
        var r = AMOUNT.matcher(fold(reply));
        while (r.find()) if (!allowed.contains(digits(r.group()))) return false;
        return true;
    }

    private static String digits(String amount) {
        String unit = amount.replaceAll("[\\d.,\\s]", "");
        return amount.replaceAll("\\D", "") + ":" + unit;
    }

    /** Folded words only, for comparing a reply with approved wording regardless of punctuation. */
    static String wordsOnly(String text) {
        return fold(text).replaceAll("[^a-z0-9]+", " ").strip();
    }

    /** Lower case, no diacritics, đ→d, single spaces. */
    static String fold(String text) {
        String s = Normalizer.normalize(text.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
            .replace('đ', 'd').replace('₫', 'd').replaceAll("\\p{M}", "");
        return s.replaceAll("\\s+", " ").strip().replaceAll("[.!?…]+$", "");
    }
}
