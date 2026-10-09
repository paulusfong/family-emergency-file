CREATE TABLE `export_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_file_id` text NOT NULL,
	`format` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`household_file_id`) REFERENCES `household_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `export_events_file_id` ON `export_events` (`household_file_id`);