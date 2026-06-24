CREATE TABLE `approval_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`approved_at` integer
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`action` text NOT NULL,
	`broker_slug` text,
	`request_id` integer,
	`from_status` text,
	`to_status` text,
	`subject` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `audit_ts_idx` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE INDEX `audit_request_idx` ON `audit_log` (`request_id`);--> statement-breakpoint
CREATE TABLE `brokers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`opt_out_url` text,
	`email` text,
	`email_domain` text,
	`channel` text DEFAULT 'manual' NOT NULL,
	`jurisdiction` text DEFAULT 'global' NOT NULL,
	`has_public_search` integer DEFAULT false NOT NULL,
	`verification_method` text DEFAULT 'none' NOT NULL,
	`requires_identity_doc` integer DEFAULT false NOT NULL,
	`form_config` text,
	`source` text,
	`source_license` text,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brokers_slug_unique` ON `brokers` (`slug`);--> statement-breakpoint
CREATE INDEX `brokers_active_idx` ON `brokers` (`active`);--> statement-breakpoint
CREATE INDEX `brokers_channel_idx` ON `brokers` (`channel`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`data` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imap_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`mailbox` text NOT NULL,
	`uid_validity` integer,
	`last_seen_uid` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broker_id` integer NOT NULL,
	`patch` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`broker_id`) REFERENCES `brokers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_id` integer NOT NULL,
	`broker_id` integer NOT NULL,
	`batch_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`confidence_status` text DEFAULT 'pending' NOT NULL,
	`channel` text NOT NULL,
	`plus_alias` text,
	`message_id` text,
	`thread_refs` text,
	`subject` text,
	`body` text,
	`deadline_at` integer,
	`sent_at` integer,
	`last_reminder_at` integer,
	`reminder_count` integer DEFAULT 0 NOT NULL,
	`proof` text,
	`error_log` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_id`) REFERENCES `brokers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `approval_batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_identity_broker_unique` ON `requests` (`identity_id`,`broker_id`);--> statement-breakpoint
CREATE INDEX `requests_status_idx` ON `requests` (`status`);--> statement-breakpoint
CREATE INDEX `requests_confidence_idx` ON `requests` (`confidence_status`);--> statement-breakpoint
CREATE INDEX `requests_message_id_idx` ON `requests` (`message_id`);--> statement-breakpoint
CREATE INDEX `requests_plus_alias_idx` ON `requests` (`plus_alias`);--> statement-breakpoint
CREATE TABLE `review_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_uid` integer,
	`uid_validity` integer,
	`from_addr` text,
	`to_addr` text,
	`subject` text,
	`received_at` integer,
	`snippet` text,
	`reason` text,
	`resolved_broker_id` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`resolved_broker_id`) REFERENCES `brokers`(`id`) ON UPDATE no action ON DELETE set null
);
