FROM php:8.4-cli

# Install system dependencies + PHP extensions Laravel needs
RUN apt-get update && apt-get install -y \
    git unzip libzip-dev libpng-dev \
    && docker-php-ext-install pdo_mysql zip \
    && rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-scripts --no-interaction --prefer-dist

COPY . .
RUN composer dump-autoload --optimize

EXPOSE 8000

# Dev server - fine for learning/local. For production, switch to php-fpm + nginx.
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]