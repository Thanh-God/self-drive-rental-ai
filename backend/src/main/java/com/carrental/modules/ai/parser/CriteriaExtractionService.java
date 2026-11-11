package com.carrental.modules.ai.parser;

import com.carrental.exception.DomainException;
import com.carrental.modules.ai.AiDiagnostics;
import com.carrental.modules.ai.AiRequestDeadline;
import com.carrental.modules.booking.service.RentalBranchCatalog;
import com.carrental.security.Actor;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Extract a draft only. A customer must review it before requesting authoritative recommendations. */
@Service
public class CriteriaExtractionService {
    private final ObjectProvider<QwenCriteriaParser> parser;
    private final RentalBranchCatalog branches;
    private final AiDiagnostics diagnostics;
    private final String model;
    private final com.carrental.modules.ai.AiDailyQuota quota;
    private final CriteriaResolver resolver;
    @Autowired
    public CriteriaExtractionService(
            ObjectProvider<QwenCriteriaParser> parser,
            RentalBranchCatalog branches,
            AiDiagnostics diagnostics,
            @Value("${app.qwen-model:qwen3:8b}") String model,
            com.carrental.modules.ai.AiDailyQuota quota) {
        this.parser=parser;this.branches=branches;this.diagnostics=diagnostics;this.model=model;this.quota=quota;this.resolver=new CriteriaResolver(branches);
    }
    /** No daily limit (unit tests and offline tools). */
    public CriteriaExtractionService(
            ObjectProvider<QwenCriteriaParser> parser,
            RentalBranchCatalog branches,
            AiDiagnostics diagnostics,
            String model) {
        this(parser,branches,diagnostics,model,com.carrental.modules.ai.AiDailyQuota.unlimited());
    }
    public CriteriaExtractionService(ObjectProvider<QwenCriteriaParser> parser,RentalBranchCatalog branches){
        this(parser,branches,new AiDiagnostics(),"qwen3:8b");
    }
    public record Draft(String pickupDate,String returnDate,String pickupBranchId,String returnBranchId,Integer passengers,Long budgetVndTotal,String transmission) {}
    public record Result(String status,Draft draft,List<String> unresolvedFields) {}
    public Result extract(Actor actor,String text){
        AiRequestDeadline deadline=AiRequestDeadline.start(AiRequestDeadline.Operation.CRITERIA_EXTRACTION);
        actor.require("USER");
        if(text==null||text.isBlank()||text.length()>1000)throw DomainException.bad("Nhập nhu cầu từ1 đến1000 ký tự.");
        // Refuse common sensitive identifiers before inference; no transcript or user account is forwarded.
        if(com.carrental.modules.ai.SensitiveText.contains(text))
            throw DomainException.bad("Vui lòng bỏ email, số điện thoại hoặc số giấy tờ khỏi nhu cầu thuê xe.");
        var engine=parser.getIfAvailable();
        if(engine==null) {
            diagnostics.record(deadline.operation(), AiDiagnostics.Provider.QWEN, model,
                AiDiagnostics.Cause.DISABLED, deadline.elapsedNanos());
            throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE,"Chưa bật đọc nhu cầu bằng Qwen; hãy dùng biểu mẫu.");
        }
        var mentioned=resolver.mentioned(text);
        CriteriaParser.Extraction extracted;
        // Counts only when the model answered: 429 busy, provider errors and timeouts give the slot back.
        try(var held=quota.reserve(actor)){
            extracted=engine.parse(text,deadline,mentioned.names());
            held.commit();
        }
        return resolver.resolve(text,extracted,mentioned);
    }
    /** See {@link CriteriaResolver#firmDatePair}. */
    static boolean firmDatePair(String text,String start,String end){return CriteriaResolver.firmDatePair(text,start,end);}
}
