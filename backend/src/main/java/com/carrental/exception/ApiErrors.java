package com.carrental.exception;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import java.util.Map;
@RestControllerAdvice
public class ApiErrors {
 @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
 ResponseEntity<?> unsupportedMethod(Exception e){return ResponseEntity.status(405).body(Map.of("message","Phương thức không được hỗ trợ."));}
 @ExceptionHandler(DomainException.class) ResponseEntity<?> domain(DomainException e){return ResponseEntity.status(e.status).body(Map.of("message",e.getMessage()));}
 @ExceptionHandler(MethodArgumentNotValidException.class) ResponseEntity<?> validation(MethodArgumentNotValidException e){
  return ResponseEntity.badRequest().body(Map.of("message","Dữ liệu không hợp lệ.","fields",e.getBindingResult().getFieldErrors().stream().map(f->f.getField()+": "+f.getDefaultMessage()).toList()));
 }
 @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class,IllegalArgumentException.class,NullPointerException.class})
 ResponseEntity<?> malformed(Exception e){return ResponseEntity.badRequest().body(Map.of("message","Định dạng dữ liệu không hợp lệ."));}
 @ExceptionHandler({DataIntegrityViolationException.class,ObjectOptimisticLockingFailureException.class})
 ResponseEntity<?> conflict(Exception e){return ResponseEntity.status(409).body(Map.of("message","Dữ liệu trùng hoặc đã thay đổi. Vui lòng tải lại."));}
}
