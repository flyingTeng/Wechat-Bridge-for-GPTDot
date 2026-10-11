CREATE TABLE `owner_notices` (
	`notice_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`binding_generation` text NOT NULL,
	`client_id` text NOT NULL,
	`state` text NOT NULL,
	`attempted_at` integer NOT NULL,
	`error_code` text
);
