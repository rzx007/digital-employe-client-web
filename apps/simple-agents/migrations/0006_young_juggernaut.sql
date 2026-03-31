CREATE TABLE `cron_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`task_name` text NOT NULL,
	`dispatch_type` text DEFAULT 'skill' NOT NULL,
	`skill_id` integer,
	`skill_name` text,
	`priority` integer DEFAULT 0,
	`cron_expression` text NOT NULL,
	`task_type` text DEFAULT '2' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`config` text,
	`state` text DEFAULT '{}' NOT NULL,
	`management_task_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`cron_task_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`session_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`triggered_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`duration` integer,
	`result` text,
	`error_message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cron_task_id`) REFERENCES `cron_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
