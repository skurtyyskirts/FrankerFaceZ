'use strict';

// ============================================================================
// Follows
// ============================================================================

import Module from 'utilities/module';
import {createElement} from 'utilities/dom';
import {getAgeParts} from 'utilities/time';

const CACHE_TIME = 5 * 60 * 1000;

// A follow is considered new if it happened within this many milliseconds
// of the response. This lets us tell new follows apart from changes to
// notification settings for an existing follow.
const NEW_FOLLOW_WINDOW = 5 * 60 * 1000;

const AUTO_MUTED_KEY = 'ffz_follows_auto_muted';


export default class Follows extends Module {
	constructor(...args) {
		super(...args);

		this.should_enable = true;

		this.inject('i18n');
		this.inject('settings');
		this.inject('site');
		this.inject('site.apollo');
		this.inject('site.twitch_data');
		this.inject('metadata');

		this.follow_cache = new Map;
		this.muting = new Set;
		// Incremented when a channel is unfollowed, to cancel pending auto-mutes.
		this.follow_generation = new Map;
		// Channels we've already turned notifications off for. If the user
		// turns them back on, we leave them alone until they re-follow. This
		// is persisted so it survives page reloads.
		this.auto_muted = this.loadAutoMuted();

		this.settings.add('metadata.follow-age', {
			default: true,

			ui: {
				path: 'Channel > Metadata >> Following',
				title: 'Follow Age',
				description: 'Display how long you have been following the current channel.',
				component: 'setting-check-box'
			},

			changed: () => this.metadata.updateMetadata('follow-age')
		});

		this.settings.add('follows.disable-notifications', {
			default: false,

			ui: {
				path: 'Channel > Behavior >> Following',
				title: 'Automatically turn off notifications when following a channel.',
				description: 'When you follow a channel, FrankerFaceZ will immediately turn off live notifications for it. You can still turn them back on with the bell button.',
				component: 'setting-check-box'
			}
		});
	}

	onEnable() {
		this.apollo.on(':response', this.onResponse, this);

		const t = this;

		this.metadata.define('follow-age', {
			refresh() {
				return this.settings.get('metadata.follow-age') ? 60000 : false;
			},

			async setup(data) {
				if ( ! this.settings.get('metadata.follow-age') )
					return null;

				const channel_id = data?.channel?.id;
				if ( ! channel_id )
					return null;

				const followed_at = await t.getSelfFollowedAt(channel_id);
				if ( ! followed_at )
					return null;

				return {
					login: data.channel.display_name || data.channel.login,
					followed_at
				};
			},

			order: 3,
			icon: 'ffz-i-heart',

			label(data) {
				if ( ! data?.followed_at || ! this.settings.get('metadata.follow-age') )
					return null;

				return t.formatAge(data.followed_at, true);
			},

			tooltip(data) {
				if ( ! data?.followed_at )
					return null;

				return [
					this.i18n.t(
						'metadata.follow-age.tooltip',
						'Following {user} for {age}',
						{
							user: data.login,
							age: t.formatAge(data.followed_at)
						}
					),
					<div class="tw-pd-t-05">
						{this.i18n.t(
							'metadata.follow-age.since',
							'(since {since,datetime})',
							{since: data.followed_at}
						)}
					</div>
				];
			}
		});
	}


	/**
	 * Format the time elapsed since a date as a human readable duration,
	 * such as "2 years, 3 months" or, in short form, "2y 3mo".
	 *
	 * @param {Date} since The date to measure from.
	 * @param {boolean} [short=false] Whether to use the short form.
	 * @returns {string} The formatted duration.
	 */
	formatAge(since, short = false) {
		const {years, months, days} = getAgeParts(since);

		if ( short ) {
			if ( years > 0 )
				return months > 0
					? this.i18n.t('follows.age.short.ym', '{years}y {months}mo', {years, months})
					: this.i18n.t('follows.age.short.y', '{years}y', {years});

			if ( months > 0 )
				return days > 0
					? this.i18n.t('follows.age.short.md', '{months}mo {days}d', {months, days})
					: this.i18n.t('follows.age.short.m', '{months}mo', {months});

			return days > 0
				? this.i18n.t('follows.age.short.d', '{days}d', {days})
				: this.i18n.t('follows.age.short.today', 'Today');
		}

		const parts = [];
		if ( years > 0 )
			parts.push(this.i18n.t('follows.age.years', '{count, plural, one {# year} other {# years}}', {count: years}));
		if ( months > 0 )
			parts.push(this.i18n.t('follows.age.months', '{count, plural, one {# month} other {# months}}', {count: months}));
		if ( days > 0 && years === 0 )
			parts.push(this.i18n.t('follows.age.days', '{count, plural, one {# day} other {# days}}', {count: days}));

		if ( ! parts.length )
			return this.i18n.t('follows.age.less-than-day', 'less than a day');

		return parts.join(', ');
	}


	/**
	 * Get when the current user followed a channel, or null if they do
	 * not follow it. Results are cached for a few minutes.
	 *
	 * @param {string} channel_id The channel's ID.
	 * @returns {Promise<Date|null>} When the follow happened, if there is one.
	 */
	getSelfFollowedAt(channel_id) {
		channel_id = String(channel_id);

		const user = this.site.getUser();
		if ( ! user?.id || String(user.id) === channel_id )
			return Promise.resolve(null);

		const cached = this.follow_cache.get(channel_id);
		if ( cached && Date.now() - cached.saved < CACHE_TIME )
			return cached.promise;

		// Always fetch from the network, since Apollo's cache isn't updated
		// when following or unfollowing.
		const promise = this.twitch_data.getUserFollowed(channel_id, null, true)
			.then(data => data?.followedAt ? new Date(data.followedAt) : null)
			.catch(err => {
				this.log.warn('Unable to load follow state for channel.', err);
				this.follow_cache.delete(channel_id);
				return null;
			});

		this.follow_cache.set(channel_id, {
			saved: Date.now(),
			promise
		});

		return promise;
	}


	onResponse(operation, data, variables) {
		const input = variables?.input;
		let target_id = input?.targetID;

		if ( ! data || ! target_id )
			return;

		const followed = data.followUser,
			unfollowed = data.unfollowUser;

		if ( ! followed && ! unfollowed )
			return;

		target_id = String(target_id);

		// Our cached follow state for this channel is stale now.
		this.follow_cache.delete(target_id);
		this.metadata.updateMetadata('follow-age');

		if ( unfollowed ) {
			this.follow_generation.set(target_id, (this.follow_generation.get(target_id) ?? 0) + 1);
			if ( this.auto_muted.delete(target_id) )
				this.saveAutoMuted();

		} else if ( ! followed.error?.code && input.disableNotifications === false )
			this.maybeDisableNotifications(target_id, followed.follow);
	}


	async maybeDisableNotifications(target_id, follow) {
		if ( ! this.settings.get('follows.disable-notifications') || this.muting.has(target_id) || this.auto_muted.has(target_id) )
			return;

		const generation = this.follow_generation.get(target_id);

		this.muting.add(target_id);
		try {
			// Twitch uses the same mutation to toggle notifications for an
			// existing follow, so make sure this is actually a new follow
			// before changing anything.
			let followed_at = follow?.followedAt;
			if ( ! followed_at ) {
				const state = await this.twitch_data.getUserFollowed(target_id, null, true);
				followed_at = state?.followedAt;
			}

			const now = Date.now() - (this.resolve('socket')?._time_drift ?? 0);
			if ( ! followed_at || Math.abs(now - new Date(followed_at).getTime()) > NEW_FOLLOW_WINDOW )
				return;

			// If the user unfollowed while we were checking, following again
			// to change notifications would undo that.
			if ( this.follow_generation.get(target_id) !== generation )
				return;

			this.log.info(`Disabling notifications for new follow of channel ${target_id}.`);
			this.auto_muted.set(target_id, Date.now());
			this.saveAutoMuted();
			await this.twitch_data.followUser(target_id, true);

		} catch(err) {
			this.log.warn('Unable to disable notifications for new follow.', err);

		} finally {
			this.muting.delete(target_id);
		}
	}


	loadAutoMuted() { // eslint-disable-line class-methods-use-this
		const out = new Map;
		try {
			const data = JSON.parse(localStorage.getItem(AUTO_MUTED_KEY) || '{}'),
				cutoff = Date.now() - NEW_FOLLOW_WINDOW * 2;

			// Entries older than the new follow window can never match again.
			for(const [id, time] of Object.entries(data))
				if ( typeof time === 'number' && time > cutoff )
					out.set(id, time);
		} catch(err) { /* no-op */ }

		return out;
	}


	saveAutoMuted() {
		try {
			if ( this.auto_muted.size )
				localStorage.setItem(AUTO_MUTED_KEY, JSON.stringify(Object.fromEntries(this.auto_muted)));
			else
				localStorage.removeItem(AUTO_MUTED_KEY);
		} catch(err) { /* no-op */ }
	}
}
