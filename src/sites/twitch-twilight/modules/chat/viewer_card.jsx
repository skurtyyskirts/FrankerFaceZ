'use strict';

import Module from 'utilities/module';
import {createElement, setChildren} from 'utilities/dom';

// ============================================================================
// Vanilla Viewer Cards
// ============================================================================

export default class ViewerCards extends Module {
	constructor(...args) {
		super(...args);

		this.inject('chat');
		this.inject('i18n');
		this.inject('settings');
		this.inject('site.css_tweaks');
		this.inject('site.fine');
		this.inject('site.follows');
		this.inject('site.twitch_data');

		this.last_login = null;
		this.info_cache = new Map;

		this.settings.add('chat.viewer-cards.follow-info', {
			default: true,
			ui: {
				path: 'Chat > Viewer Cards >> Information',
				title: 'Display account age and follow age.',
				description: 'Show when a user created their account and how long they have been following the current channel on their viewer card.',
				component: 'setting-check-box'
			},
			changed: () => {
				for(const inst of this.ViewerCard.instances)
					this.updateFollowInfo(inst);
			}
		});

		this.settings.add('chat.viewer-cards.highlight-chat', {
			default: false,
			ui: {
				path: 'Chat > Viewer Cards >> Appearance',
				title: 'Highlight messages from users with open viewer cards.',
				component: 'setting-check-box'
			}
		});

		this.settings.add('chat.viewer-cards.color', {
			default: '',
			ui: {
				path: 'Chat > Viewer Cards >> Appearance',
				title: 'Highlight Color',
				component: 'setting-color-box'
			}
		});

		this.settings.add('chat.viewer-cards.use-color', {
			requires: ['chat.viewer-cards.highlight-chat', 'chat.viewer-cards.color'],
			process(ctx) {
				if ( ctx.get('chat.viewer-cards.highlight-chat') )
					return ctx.get('chat.viewer-cards.color');
			}
		})

		this.ViewerCard = this.fine.define(
			'chat-viewer-card',
			n => n.props?.targetLogin && (n.props?.hideViewerCard || n.props?.modUserMutationResult)
		);
	}

	onEnable() {
		this.chat.context.on('changed:chat.viewer-cards.highlight-chat', this.refreshStyle, this);
		this.chat.context.on('changed:chat.viewer-cards.color', this.refreshStyle, this);
		this.on('..:update-colors', this.refreshStyle, this);

		this.ViewerCard.ready((cls, instances) => {
			for (const inst of instances) {
				this.updateCard(inst);
			}
		});
		this.ViewerCard.on('mount', this.updateCard, this);
		this.ViewerCard.on('update', this.updateCard, this);
		this.ViewerCard.on('unmount', this.unmountCard, this);
	}

	refreshStyle() {
		this.updateStyle(this.last_login);
	}

	updateStyle(login) {
		// Make sure we're dealing with lower-case logins.
		if ( typeof login === 'string' )
			login = login.toLowerCase();

		this.last_login = login;
		if ( login && this.chat.context.get('chat.viewer-cards.highlight-chat') ) {
			let color = this.chat.context.get('chat.viewer-cards.color');
			if ( color && color.length )
				color = this.parent.inverse_colors.process(color);
			else if ( this.chat.context.get('theme.is-dark') )
				color = 'rgba(0,80,255,0.2)';
			else
				color = 'rgba(128,170,255,0.2)';

			this.css_tweaks.set('viewer-card-highlight', `
body .chat-room .chat-scrollable-area__message-container > div:nth-child(1n+0) > .chat-line__message:not(.chat-line--inline):not(.something-nonexistent)[data-user="${login}"],
body .chat-room .chat-scrollable-area__message-container > div:nth-child(1n+0) > div > .chat-line__message:not(.chat-line--inline):not(.something-nonexistent)[data-user="${login}"],
body .chat-room .chat-line__message:not(.chat-line--inline):nth-child(1n+0)[data-user="${login}"] {
	background-color: ${color} !important;
}`);
		} else
			this.css_tweaks.delete('viewer-card-highlight');
	}

	updateCard(inst) {
		this.updateStyle(inst.props && inst.props.targetLogin);
		this.updateFollowInfo(inst);
	}

	unmountCard(inst) {
		this.updateStyle();
		inst._ffz_follow_info?.remove();
		inst._ffz_follow_info = null;
	}


	getChannelID(inst) {
		const props = inst?.props;
		return props?.channelID ?? props?.channelId ?? props?.channel?.id ??
			this.chat.context.get('context.channelID');
	}


	getFollowInfo(channel_id, login) {
		const key = `${channel_id}:${login}`,
			cached = this.info_cache.get(key);

		if ( cached && Date.now() - cached.saved < 60000 )
			return cached.promise;

		const promise = this.twitch_data.getUserFollowInfo(channel_id, null, login)
			.catch(err => {
				this.log.warn('Unable to load follow info for viewer card.', err);
				this.info_cache.delete(key);
				return null;
			});

		this.info_cache.set(key, {saved: Date.now(), promise});
		return promise;
	}


	findInfoContainer(inst) {
		const node = this.fine.getChildNode(inst);
		const root = node instanceof Element
			? node
			: document.querySelector('.viewer-card-layer .viewer-card, [data-a-target="viewer-card"], .viewer-card');

		if ( ! root )
			return null;

		const name = root.querySelector('.viewer-card-header__display-name');
		if ( name )
			return {parent: name, fallback: false};

		const card = root.matches('.viewer-card, [data-a-target="viewer-card"]')
			? root
			: root.querySelector('.viewer-card, [data-a-target="viewer-card"]');

		return {parent: card || root, fallback: true};
	}


	async updateFollowInfo(inst, attempt = 0) {
		const login = inst?.props?.targetLogin?.toLowerCase?.(),
			channel_id = this.getChannelID(inst);

		let el = inst._ffz_follow_info;

		if ( ! login || ! channel_id || ! this.chat.context.get('chat.viewer-cards.follow-info') ) {
			el?.remove();
			inst._ffz_follow_info = null;
			return;
		}

		const container = this.findInfoContainer(inst);
		if ( ! container ) {
			// The card might not have rendered its contents yet.
			if ( attempt < 10 )
				setTimeout(() => this.updateFollowInfo(inst, attempt + 1), 100);
			return;
		}

		const key = `${channel_id}:${login}`;
		if ( el && el._ffz_key === key && el.isConnected )
			return;

		if ( ! el ) {
			el = inst._ffz_follow_info = (<div class="ffz--viewer-card-follow-info" />);
		}

		el._ffz_key = key;
		el.classList.toggle('ffz--viewer-card-follow-info--fallback', container.fallback);

		if ( el.parentElement !== container.parent ) {
			if ( container.fallback )
				container.parent.insertBefore(el, container.parent.firstChild);
			else
				container.parent.appendChild(el);
		}

		const info = await this.getFollowInfo(channel_id, login);

		// Make sure the card wasn't changed or closed while we were loading.
		if ( inst._ffz_follow_info !== el || el._ffz_key !== key )
			return;

		setChildren(el, this.renderFollowInfo(info));
		this.emit('tooltips:cleanup');
	}


	renderFollowInfo(info) {
		if ( ! info )
			return null;

		const out = [];

		if ( info.createdAt )
			out.push(<span
				class="ffz--follow-info-item ffz-tooltip"
				data-title={this.i18n.t('viewer-card.follow-info.created-tip', 'Account Created: {created,datetime}', {created: info.createdAt})}
			>
				<figure class="ffz-i-cake" />
				{this.i18n.t('viewer-card.follow-info.created', 'Created {age} ago', {
					age: this.follows.formatAge(info.createdAt, true)
				})}
			</span>);

		if ( info.followedAt )
			out.push(<span
				class="ffz--follow-info-item ffz-tooltip"
				data-title={this.i18n.t('viewer-card.follow-info.followed-tip', 'Followed: {followed,datetime} ({age})', {
					followed: info.followedAt,
					age: this.follows.formatAge(info.followedAt)
				})}
			>
				<figure class="ffz-i-heart" />
				{this.i18n.t('viewer-card.follow-info.followed', 'Following {age}', {
					age: this.follows.formatAge(info.followedAt, true)
				})}
			</span>);

		else if ( info.followedAt === null )
			out.push(<span class="ffz--follow-info-item">
				<figure class="ffz-i-heart-empty" />
				{this.i18n.t('viewer-card.follow-info.not-following', 'Not Following')}
			</span>);

		return out;
	}
}
