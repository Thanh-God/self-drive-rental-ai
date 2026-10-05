package com.carrental.modules.auth.controller;
import com.carrental.modules.user.service.AccountService;
import com.carrental.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import java.util.Map;
@RestController @RequestMapping("/api/v1/auth")
public class AuthController {
 private final AccountService accounts;private final TokenService tokens;
 public AuthController(AccountService accounts,TokenService tokens){this.accounts=accounts;this.tokens=tokens;}
 public record Login(@NotBlank @Email @Size(max=254) String email,@NotBlank @Size(max=72) String password){}
 public record Register(@NotBlank @Email @Size(max=254) String email,@NotBlank @Size(max=100) String fullName,@NotBlank @Size(min=8,max=72) String password){}
 @PostMapping("/register") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
 public Object register(@Valid @RequestBody Register r){var a=accounts.register(r.email(),r.fullName(),r.password());return Map.of("token",tokens.issue(a),"user",accounts.view(a));}
 @PostMapping("/login") public Object login(@Valid @RequestBody Login r){var a=accounts.authenticate(r.email(),r.password());return Map.of("token",tokens.issue(a),"user",accounts.view(a));}
 @GetMapping("/me") public Object me(@AuthenticationPrincipal Actor actor){return accounts.profile(actor.id());}
 @PostMapping("/logout") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
 public void logout(@AuthenticationPrincipal Actor actor){accounts.revoke(actor.id());}
}
