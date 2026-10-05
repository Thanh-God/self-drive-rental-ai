package com.carrental.modules.booking.controller;
import com.carrental.modules.booking.service.BookingService;
import com.carrental.security.Actor;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
@RestController @RequestMapping("/api/v1/bookings")
public class BookingController {
 private final BookingService service;
 public BookingController(BookingService s){service=s;}
 @GetMapping public Object list(@AuthenticationPrincipal Actor a){return service.list(a);}
 @PostMapping("/quote") public Object quote(@AuthenticationPrincipal Actor a,@RequestBody BookingService.Input i){return service.quote(a,i);}
 @PostMapping @ResponseStatus(org.springframework.http.HttpStatus.CREATED) public Object create(@AuthenticationPrincipal Actor a,@RequestBody BookingService.Input i){return service.create(a,i);}
 @GetMapping("/{id}") public Object detail(@AuthenticationPrincipal Actor a,@PathVariable String id){return service.detail(a,id);}
}
