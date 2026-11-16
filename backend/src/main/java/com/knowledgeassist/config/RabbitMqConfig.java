package com.knowledgeassist.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMqConfig {

    public static final String INGESTION_EXCHANGE = "knowledgeassist.ingestion.exchange";
    public static final String INGESTION_QUEUE = "knowledgeassist.ingestion.queue";
    public static final String INGESTION_ROUTING_KEY = "document.ingest";
    public static final String INGESTION_DLX = "knowledgeassist.ingestion.dlx";
    public static final String INGESTION_DLQ = "knowledgeassist.ingestion.dlq";
    public static final String INGESTION_DLQ_KEY = "document.ingest.dlq";

    @Bean
    public DirectExchange ingestionExchange() {
        return new DirectExchange(INGESTION_EXCHANGE, true, false);
    }

    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange(INGESTION_DLX, true, false);
    }

    @Bean
    public Queue ingestionQueue() {
        return QueueBuilder.durable(INGESTION_QUEUE)
                .withArgument("x-dead-letter-exchange", INGESTION_DLX)
                .withArgument("x-dead-letter-routing-key", INGESTION_DLQ_KEY)
                .build();
    }

    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable(INGESTION_DLQ).build();
    }

    @Bean
    public Binding ingestionBinding(Queue ingestionQueue, DirectExchange ingestionExchange) {
        return BindingBuilder.bind(ingestionQueue).to(ingestionExchange).with(INGESTION_ROUTING_KEY);
    }

    @Bean
    public Binding deadLetterBinding(Queue deadLetterQueue, DirectExchange deadLetterExchange) {
        return BindingBuilder.bind(deadLetterQueue).to(deadLetterExchange).with(INGESTION_DLQ_KEY);
    }

    @Bean
    public Jackson2JsonMessageConverter messageConverter() {
        return new Jackson2JsonMessageConverter();
    }
}
