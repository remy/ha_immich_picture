docker stop scrape
docker rm scrape
docker run -d --name scrape -p 4545:3000 -v $(pwd)/scripts:/app/scripts scrape-api