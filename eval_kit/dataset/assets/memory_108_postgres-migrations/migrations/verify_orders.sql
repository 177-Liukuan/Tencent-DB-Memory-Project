SELECT count(*) AS invalid_status_count FROM orders WHERE status NOT IN ('created','paid','cancelled');
SELECT count(*) AS negative_total_count FROM orders WHERE total_minor < 0;
