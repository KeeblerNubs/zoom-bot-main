FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends wireguard-tools iproute2 iptables resolvconf \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV WIREGUARD_ENABLED=false
ENV WIREGUARD_INTERFACE=wg0
ENV WIREGUARD_CONFIG_PATH=/etc/wireguard/wg0.conf

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "telegram-bot.js"]
