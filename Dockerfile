FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends wireguard-tools iproute2 iptables resolvconf \
    && rm -rf /var/lib/apt/lists/*

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV WIREGUARD_ENABLED=false
ENV WIREGUARD_INTERFACE=wg0
ENV WIREGUARD_CONFIG_PATH=/etc/wireguard/wg0.conf

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "telegram-bot.js"]
