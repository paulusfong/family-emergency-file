CREATE TABLE `checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`item_key` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_items_section_key` ON `checklist_items` (`section_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `entries_section_id` ON `entries` (`section_id`);