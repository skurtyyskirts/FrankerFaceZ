
export function getBuster(resolution: number = 5) {
	const now = Math.floor(Date.now() / 1000);
	return now - (now % resolution);
}

export function duration_to_string(
	elapsed: number,
	separate_days?: boolean,
	days_only?: boolean,
	no_hours?: boolean,
	no_seconds?: boolean
) {
	const seconds = elapsed % 60;
	let minutes = Math.floor(elapsed / 60),
		hours = Math.floor(minutes / 60),
		days = '';

	minutes = minutes % 60;

	if ( separate_days ) {
		const day_count = Math.floor(hours / 24);
		hours = hours % 24;
		if ( days_only && day_count > 0 )
			return `${days} days`;

		days = day_count > 0 ? `${day_count} days, ` : '';
	}

	const show_hours = (no_hours === false || days?.length > 0 || hours > 0);

	return `${days}${
		show_hours ? `${days && hours < 10 ? '0' : ''}${hours}:` : ''
	}${show_hours && minutes < 10 ? '0' : ''}${minutes}${
		no_seconds ? '' : `:${seconds < 10 ? '0' : ''}${seconds}`}`;
}


export function print_duration(seconds: number) {
	let minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	minutes %= 60;
	seconds %= 60;

	return `${hours > 0 ? `${hours}:${minutes < 10 ? '0' : ''}` : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}


export function durationForChat(elapsed: number) {
	const seconds = elapsed % 60;
	let minutes = Math.floor(elapsed / 60);
	let hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	minutes = minutes % 60;
	hours = hours % 24;

	return `${days > 0 ? `${days}d` : ''}${hours > 0 ? `${hours}h` : ''}${minutes > 0 ? `${minutes}m` : ''}${seconds > 0 ? `${seconds}s` : ''}`;
}


export function durationForURL(elapsed: number) {
	const seconds = elapsed % 60;
	let minutes = Math.floor(elapsed / 60);
	const hours = Math.floor(minutes / 60);

	minutes = minutes % 60;

	return `${hours > 0 ? `${hours}h` : ''}${minutes > 0 ? `${minutes}m` : ''}${seconds > 0 ? `${seconds}s` : ''}`;
}


/**
 * Split the time elapsed since a date into whole years, months, and days.
 *
 * @param since The starting date.
 * @param now The ending date. Defaults to the current time.
 */
export function getAgeParts(since: Date | string | number, now: Date | string | number = Date.now()) {
	const end = new Date(now);
	let start = new Date(since);
	if ( isNaN(start.getTime()) || start > end )
		return {years: 0, months: 0, days: 0};

	let total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
	if ( addMonths(start, total_months) > end )
		total_months--;

	start = addMonths(start, total_months);

	return {
		years: Math.floor(total_months / 12),
		months: total_months % 12,
		days: Math.floor((end.getTime() - start.getTime()) / 86400000)
	};
}

function addMonths(date: Date, months: number) {
	const out = new Date(date);
	const day = out.getDate();
	out.setDate(1);
	out.setMonth(out.getMonth() + months);
	// Clamp to the last day of the month, so Jan 31 + 1 month is Feb 28/29.
	const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
	out.setDate(Math.min(day, last));
	return out;
}
