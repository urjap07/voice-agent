-- Use in n8n "Execute SQL" node after AI Agent + Structured Output Parser.
-- Map parser JSON fields to query parameters (or use n8n expressions).

INSERT INTO bookings (
    mumukshu_name,
    mumukshu_phone,
    start_date,
    end_date,
    total_persons,
    wants_room,
    floor_preference,
    booked_shibir,
    has_breakfast,
    has_lunch,
    has_dinner,
    dietary_preference
) VALUES (
    {{ $json.mumukshu_name }},
    {{ $json.mumukshu_phone }},
    {{ $json.start_date }},
    {{ $json.end_date }},
    {{ $json.total_persons }},
    {{ $json.wants_room }},
    {{ $json.floor_preference }},
    {{ $json.booked_shibir }},
    {{ $json.has_breakfast }},
    {{ $json.has_lunch }},
    {{ $json.has_dinner }},
    {{ $json.dietary_preference }}
);
