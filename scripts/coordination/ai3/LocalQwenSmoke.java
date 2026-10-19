import com.carrental.modules.ai.parser.QwenCriteriaParser;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Synthetic data only; no cloud calls. Run against an already installed qwen3:8b. */
class LocalQwenSmoke {
    public static void main(String[] args) throws Exception {
        var json=new ObjectMapper();var parser=new QwenCriteriaParser(json,"qwen3:8b");
        long start=System.nanoTime();
        var full=parser.parse("Tôi cần xe cho4 người, tổng ngân sách3 triệu đồng, nhận tại Đà Nẵng ngày20/10/2100 và trả tại Đà Nẵng ngày24/10/2100, ưu tiên xe tự động.");
        if(!Integer.valueOf(4).equals(full.passengers())||!Long.valueOf(3000000).equals(full.budgetVndTotal())
            ||!"2100-10-20".equals(full.pickupDate())||!"2100-10-24".equals(full.returnDate())||!"AUTO".equals(full.transmission()))throw new AssertionError("Complete extraction failed: "+json.writeValueAsString(full));
        var missing=parser.parse("Tôi cần xe cho4 người, tổng ngân sách3 triệu đồng. Chưa quyết định ngày nhận và trả, cũng chưa chọn điểm nhận trả.");
        if(missing.pickupDate()!=null||missing.returnDate()!=null||missing.pickupBranchName()!=null||missing.returnBranchName()!=null)throw new AssertionError("Missing facts were invented");
        System.out.println(json.writeValueAsString(java.util.Map.of("complete",full,"missing",missing,"seconds",(System.nanoTime()-start)/1e9)));
    }
}
