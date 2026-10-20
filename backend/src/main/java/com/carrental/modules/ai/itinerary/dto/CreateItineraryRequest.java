package com.carrental.modules.ai.itinerary.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateItineraryRequest(
    @NotBlank @Size(min = 1, max = 200) String title,
    @NotBlank String fingerprint,
    @NotNull @Valid ItineraryPreviewRequest preview
) {}
