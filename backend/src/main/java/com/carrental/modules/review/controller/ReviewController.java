package com.carrental.modules.review.controller;
import com.carrental.modules.review.service.ReviewService;
import com.carrental.security.Actor;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
@RestController @RequestMapping("/api/v1") public class ReviewController {
 private final ReviewService s;public ReviewController(ReviewService s){this.s=s;}
 public record Input(String bookingId,int rating,String content){}
 public record Moderation(boolean hidden,long version){}
 @PostMapping("/reviews") public void create(@AuthenticationPrincipal Actor a,@RequestBody Input i){s.create(a,i.bookingId(),i.rating(),i.content());}
 @GetMapping("/vehicles/{id}/reviews") public Object publicList(@PathVariable String id){return s.publicList(id);}
 @GetMapping("/admin/reviews") public Object list(@AuthenticationPrincipal Actor a){return s.list(a);}
 @PatchMapping("/admin/reviews/{id}") public void moderate(@AuthenticationPrincipal Actor a,@PathVariable String id,@RequestBody Moderation i){s.moderate(a,id,i.hidden(),i.version());}
}
